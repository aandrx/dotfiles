/** Tracks workflow inspector state and deferred terminal notifications. */
export class WorkflowNotificationGate {
  private readonly openIds = new Set<string>();
  private readonly deferredIds = new Set<string>();

  isOpen(id: string): boolean { return this.openIds.has(id); }
  hasDeferred(id: string): boolean { return this.deferredIds.has(id); }

  defer(id: string): void { this.deferredIds.add(id); }

  open(id: string): void { this.openIds.add(id); }

  close(id: string): boolean {
    this.openIds.delete(id);
    return this.deferredIds.delete(id);
  }

  reset(): void {
    this.openIds.clear();
    this.deferredIds.clear();
  }
}
