export const meta = {
  name: 'implement-review',
  description: 'Plan when needed, implement serially, gate on the test command, then review correctness and regression in parallel',
  phases: [{ title: 'Plan' }, { title: 'Implement' }, { title: 'Verify' }, { title: 'Review' }],
}

const task = args?.task ? String(args.task).trim() : ''
if (!task) return { completed: false, error: 'Supply args.task with a scoped implementation request.' }
const testCommand = args?.test === undefined || args.test === null ? '' : String(args.test).trim()
// ready=true skips planning and sends the task directly to implementation.
const ready = args?.ready === true
let plan = null

if (!ready) {
  phase('Plan')
  plan = await agent(
    `Create a concise implementation plan for this task. Do not implement it.\n\nTask: ${task}`,
    { agentType: 'Plan', label: 'plan' },
  )
  if (plan === null) {
    log('planning failed; implementation and review skipped')
    return { completed: false, stage: 'plan', plan: null, implementation: null, review: null }
  }
}

phase('Implement')
const prompt = ready
  ? task
  : `Implement the task using this plan.\n\nPlan:\n${plan}\n\nTask: ${task}`
const options = { agentType: 'implementer', label: 'implement' }
if (testCommand) options.gate = testCommand
const implementation = await agent(prompt, options)
if (implementation === null) {
  log('implementation failed or its test gate failed; reviewers skipped')
  return { completed: false, stage: 'implement', implementation: null, review: null, testGate: testCommand ? 'failed' : 'not supplied' }
}

// The gate runs the command itself, so "the tests pass" is observed rather than asserted.
let verify = null
if (testCommand) {
  phase('Verify')
  verify = await agent(
    `Run \`${testCommand}\` and report its result verbatim: exit status, failing test names, and the first error line if it fails. Change nothing.`,
    { label: 'verify', gate: testCommand, effort: 'low' },
  )
  if (verify === null) {
    log(`test gate failed: ${testCommand}`)
    return { completed: false, stage: 'verify', implementation, review: null, testGate: 'failed', testCommand }
  }
}

// Both reviewers inspect the real diff; intent comes from the task, not from the implementer's summary.
const shared = `Task intent: ${task}

Run \`git status --porcelain\` and \`git diff\` to obtain the change under review. Read the surrounding code before judging a hunk. Judge the change against the task intent above, not against the implementer's own report.

Implementation report (context only, not evidence):
${implementation}

Report findings with file and line, consequence, severity (Important, Nit, or Pre-existing, with git blame proof for pre-existing), and confidence. Cap the list at the consequential findings. State what you could not check.`

phase('Review')
const [correctness, regression] = await parallel([
  () =>
    agent(
      `Correctness pass. Does the change do what the task asks, and is that logic right? Look for wrong conditions, off-by-one and boundary handling, unhandled errors and empty input, incorrect state transitions, concurrency or ordering mistakes, and resource leaks. Ignore style and performance here.\n\n${shared}`,
      { agentType: 'reviewer', label: 'review:correctness' },
    ),
  () =>
    agent(
      `Regression pass. What did this change break or fail to update? Look for callers and contracts left stale, changed defaults or error types reaching existing callers, tests and fixtures not updated, migration or schema steps missing, docs and config drift, and behaviour on paths the diff does not touch but affects. Note diff-visible performance defects only: serialized independent work, redundant passes, unbounded fan-out, and batch or memory boundaries.\n\n${shared}`,
      { agentType: 'reviewer', label: 'review:regression' },
    ),
])

if (correctness === null && regression === null) {
  log('both review passes failed; no reviewer verification is available')
  return { completed: false, stage: 'review', implementation, review: null, testGate: testCommand ? 'passed' : 'not supplied' }
}
return {
  completed: true,
  stage: 'review',
  implementation,
  review: { correctness, regression },
  testGate: testCommand ? 'passed' : 'not supplied',
  testCommand: testCommand || null,
}
