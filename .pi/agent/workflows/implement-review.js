export const meta = {
  name: 'implement-review',
  description: 'Plan when needed, implement serially, optionally gate, then review successful work',
  phases: [{ title: 'Plan' }, { title: 'Implement' }, { title: 'Review' }],
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
  log('implementation failed or its test gate failed; reviewer skipped')
  return { completed: false, stage: 'implement', implementation: null, review: null, testGate: testCommand ? 'failed' : 'not supplied' }
}

phase('Review')
const review = await agent(
  `Review the implemented changes for correctness, regressions, and unmet requirements. Report concrete findings and any verification limits.\n\nTask: ${task}\n\nImplementation report:\n${implementation}`,
  { agentType: 'reviewer', label: 'review' },
)
if (review === null) {
  log('review failed; no reviewer verification is available')
  return { completed: false, stage: 'review', implementation, review: null, testGate: testCommand ? 'passed' : 'not supplied' }
}
return { completed: true, stage: 'review', implementation, review, testGate: testCommand ? 'passed' : 'not supplied' }
