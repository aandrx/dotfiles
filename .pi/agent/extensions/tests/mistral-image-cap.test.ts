import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { countImages, trimImages, default as mistralImageCap } from "../mistral-image-cap.ts";
export default function noop() {}
const isMain = !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

const img = (n: number) => ({ type: "image_url", imageUrl: `data:image/png;base64,AAAA${n}` });
const txt = (t: string) => ({ type: "text", text: t });
const userWith = (parts: unknown[]) => ({ role: "user", content: parts });

type Payload = { model?: string; messages?: Array<{ role?: string; content?: unknown }> };

/** Minimal Pi stand-in: capture handlers so the gate can be exercised directly. */
function harness() {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const notices: string[] = [];
  const pi = { on: (name: string, fn: (event: unknown, ctx: unknown) => unknown) => handlers.set(name, fn) };
  mistralImageCap(pi as never);
  const ctx = (model: unknown) => ({ model, ui: { notify: (message: string) => notices.push(message) } });
  const request = async (payload: Payload, model: unknown) =>
    (await handlers.get("before_provider_request")!({ type: "before_provider_request", payload }, ctx(model))) as
      | Payload
      | undefined;
  return { handlers, notices, request };
}

if (isMain) {
  test("counts image parts and ignores text, string content, and missing content", () => {
    assert.equal(countImages([userWith([txt("a"), img(1)]), { role: "user", content: "plain" }]), 1);
    assert.equal(countImages([{ role: "assistant", content: [txt("x")] }]), 0);
    assert.equal(countImages([{}, userWith([img(1), img(2)])]), 2);
  });

  test("keeps the newest images and drops the oldest", () => {
    const messages = [];
    for (let i = 0; i < 25; i++) messages.push(userWith([txt(`shot ${i}`), img(i)]));
    const out = trimImages({ model: "m", messages }, 20);
    assert.equal(out.removed, 6);
    assert.equal(countImages(out.payload.messages!), 19);
    const flat = out.payload.messages!.flatMap((message) => message.content as Array<Record<string, unknown>>);
    assert.ok(flat.some((part) => part.imageUrl === img(24).imageUrl));
    assert.ok(!flat.some((part) => part.imageUrl === img(0).imageUrl));
    assert.ok(flat.some((part) => part.text === "shot 0"));
  });

  test("under the cap the payload is returned unchanged and identical", () => {
    const payload = { model: "m", messages: [userWith([txt("a"), img(1)]), userWith([img(2)])] };
    const out = trimImages(payload, 3);
    assert.equal(out.removed, 0);
    assert.equal(out.payload, payload);
  });

  test("an image-only message that loses its image becomes a text placeholder", () => {
    const payload = { model: "m", messages: [userWith([img(1)]), userWith([img(2)]), userWith([img(3)])] };
    const out = trimImages(payload, 2);
    assert.equal(out.removed, 2);
    const first = out.payload.messages![0].content as Array<Record<string, unknown>>;
    assert.equal(first[0].type, "text");
    assert.match(String(first[0].text), /image omitted/);
    assert.equal(countImages(out.payload.messages!), 1);
  });

  test("tool results keep their text and lose only the image", () => {
    const payload = {
      model: "m",
      messages: [
        { role: "tool", toolCallId: "t1", name: "read", content: [txt("Read image file [image/png]"), img(1)] },
        { role: "user", content: [txt("next"), img(2)] },
      ],
    };
    const out = trimImages(payload, 2);
    assert.equal(out.removed, 1);
    const content = out.payload.messages![0].content as Array<Record<string, unknown>>;
    assert.equal(content.length, 1);
    assert.equal(content[0].text, "Read image file [image/png]");
    assert.equal(countImages(out.payload.messages!), 1);
  });

  test("string content and assistant messages are never rewritten", () => {
    const payload = {
      model: "m",
      messages: [
        { role: "user", content: "plain string" },
        { role: "assistant", content: [txt("hello")], toolCalls: [] },
        { role: "user", content: [img(1), img(2)] },
      ],
    };
    const out = trimImages(payload, 2);
    assert.equal(out.removed, 1);
    assert.equal(out.payload.messages![0].content, "plain string");
    assert.deepEqual(out.payload.messages![1], payload.messages[1]);
  });

  test("a cap of 1 drops every image", () => {
    const out = trimImages({ model: "m", messages: [userWith([img(1)]), userWith([img(2)])] }, 1);
    assert.equal(out.removed, 2);
    assert.equal(countImages(out.payload.messages!), 0);
  });

  test("a payload without messages is returned unchanged", () => {
    const payload = { model: "m" };
    const out = trimImages(payload, 5);
    assert.equal(out.removed, 0);
    assert.equal(out.payload, payload);
  });

  test("the hook ignores every other API, so uncapped providers are untouched", async () => {
    const { request } = harness();
    const payload = { model: "m", messages: [userWith([img(1), img(2), img(3), img(4), img(5)])] };
    assert.equal(await request(payload, { api: "openai-completions", id: "deepseek-v4.1-flash" }), undefined);
    assert.equal(await request(payload, { api: "anthropic-messages", id: "claude-opus-5" }), undefined);
    assert.equal(await request(payload, undefined), undefined);
  });

  test("the hook ignores mistral models without a known cap", async () => {
    const { request } = harness();
    const payload = { model: "m", messages: [userWith([img(1), img(2), img(3)])] };
    assert.equal(await request(payload, { api: "mistral-conversations", id: "codestral-2508" }), undefined);
  });

  test("the hook reads the declared cap and the observed fallback table", async () => {
    const { request } = harness();
    const payload = { model: "m", messages: [userWith([img(1), img(2), img(3), img(4), img(5)])] };

    const declared = await request(payload, {
      api: "mistral-conversations",
      id: "declared-model",
      inputLimits: { images: { maxPerRequest: 3 } },
    });
    assert.equal(countImages(declared!.messages!), 2);

    const tenImages = { model: "m", messages: Array.from({ length: 10 }, (_unused, i) => userWith([img(i)])) };
    const fallback = await request(tenImages, { api: "mistral-conversations", id: "zai-glm-5-3-flash" });
    assert.equal(countImages(fallback!.messages!), 7);

    const deepseek = await request(
      { model: "m", messages: Array.from({ length: 25 }, (_unused, i) => userWith([img(i)])) },
      { api: "mistral-conversations", id: "deepseek-v4-1-flash-1017" },
    );
    assert.equal(countImages(deepseek!.messages!), 19);
  });

  test("the hook leaves an under-cap request alone and announces a trim once", async () => {
    const { notices, request } = harness();
    const small = { model: "m", messages: [userWith([img(1)])] };
    assert.equal(await request(small, { api: "mistral-conversations", id: "zai-glm-5-3-flash" }), undefined);
    assert.equal(notices.length, 0);

    const big = { model: "m", messages: Array.from({ length: 10 }, (_unused, i) => userWith([img(i)])) };
    const model = { api: "mistral-conversations", id: "zai-glm-5-3-flash" };
    await request(big, model);
    await request(big, model);
    assert.equal(notices.length, 1);
    assert.match(notices[0], /dropped 3 older image/);
  });
}
