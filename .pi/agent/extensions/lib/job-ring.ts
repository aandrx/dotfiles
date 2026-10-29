export class JobRing {
  private chunks: Buffer[] = [];
  private bytes = 0;
  private base = 0;
  private total = 0;
  readonly capacity: number;
  constructor(capacity: number) { if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("capacity must be positive"); this.capacity = capacity; }
  append(input: string | Buffer): void {
    const b = Buffer.from(input); if (!b.length) return;
    this.chunks.push(b); this.bytes += b.length; this.total += b.length;
    while (this.bytes > this.capacity) {
      const excess = this.bytes - this.capacity;
      const c = this.chunks[0];
      if (c.length <= excess) { this.chunks.shift(); this.bytes -= c.length; this.base += c.length; }
      else {
        let cut = excess;
        while (cut < c.length && (c[cut] & 0xc0) === 0x80) cut++;
        this.chunks[0] = c.subarray(cut); this.bytes -= cut; this.base += cut;
      }
    }
  }
  read(offset = this.base): { text: string; start: number; end: number; lost: boolean } {
    const start = Math.max(this.base, Math.min(this.total, Math.floor(offset)));
    const all = Buffer.concat(this.chunks);
    let index = start - this.base;
    while (index < all.length && index > 0 && (all[index] & 0xc0) === 0x80) index++;
    const safeStart = this.base + index;
    return { text: all.subarray(index).toString("utf8"), start: safeStart, end: this.total, lost: offset < this.base };
  }
}
