export const meta = {
  name: 'research',
  description: 'Research independent subtasks in bounded parallel batches and synthesize results',
  phases: [{ title: 'Research' }, { title: 'Synthesize' }],
}

const input = args?.tasks
const taskInputs = Array.isArray(input) && input.length > 0
  ? input
  : args?.task
    ? [args.task]
    : []
const tasks = taskInputs.map((task, index) => ({ index, task: String(task) }))
if (tasks.length === 0) {
  return { completed: false, error: 'Supply args.task or a non-empty args.tasks array.' }
}

phase('Research')
log(`Starting research for ${tasks.length} task${tasks.length === 1 ? '' : 's'}`)
const results = Array(tasks.length).fill(null)
for (let start = 0; start < tasks.length; start += 3) {
  const batch = tasks.slice(start, start + 3)
  const completed = await parallel(batch.map(({ index, task }) => async () => {
    log(`Task ${index + 1}/${tasks.length} starting`)
    try {
      const result = await agent(
        `Research this independent subtask. Report evidence and uncertainty; do not claim work beyond what you verified.\n\nSubtask: ${task}`,
        { agentType: 'researcher', label: `research:${index + 1}` },
      )
      const status = result === null ? 'unavailable' : 'completed'
      log(`Task ${index + 1}/${tasks.length} ${status}`)
      return { status, result }
    } catch (error) {
      log(`Task ${index + 1}/${tasks.length} rejected`)
      return { status: 'rejected', error: String(error), result: null }
    }
  }))
  completed.forEach((outcome, offset) => {
    results[batch[offset].index] = outcome
  })
}

const taskResults = tasks.map(({ index, task }) => ({ task, ...results[index] }))
phase('Synthesize')
log('Starting synthesis')
let report = null
let synthesisStatus = 'unavailable'
let synthesisError
try {
  report = await agent(
    [
      'Synthesize these independent research results. Preserve failures and gaps explicitly; do not claim missing work is complete.',
      ...tasks.map(({ index, task }) => {
        const outcome = results[index]
        return `\n## Task ${index + 1}: ${task}\nSTATUS: ${outcome?.status ?? 'missing'}${outcome?.error ? `\nERROR: ${outcome.error}` : ''}${outcome?.result ? `\nRESULT:\n${outcome.result}` : ''}`
      }),
    ].join('\n'),
    { agentType: 'Plan', label: 'synthesize' },
  )
  synthesisStatus = report === null ? 'unavailable' : 'completed'
  log(`Synthesis ${synthesisStatus}`)
} catch (error) {
  synthesisStatus = 'rejected'
  log('Synthesis rejected')
  synthesisError = String(error)
}

const allCompleted = taskResults.every((outcome) => outcome.status === 'completed') && synthesisStatus === 'completed'
return { completed: allCompleted, tasks: taskResults, synthesis: report, synthesisStatus, ...(synthesisError ? { synthesisError } : {}) }
