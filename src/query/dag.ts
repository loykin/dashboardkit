import { parseRefs } from './parser'

// ─── DAG Types ──────────────────────────────────────────────────────────────────

/** Circular dependency detection error */
export class CircularDependencyError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`Circular variable dependency: ${cycle.join(' → ')}`)
    this.name = 'CircularDependencyError'
  }
}

/**
 * Build a DAG from a variable list and return the topologically sorted execution order.
 *
 * @param variables - Array of { name, query? } variable descriptors
 * @returns Topologically sorted variable name array (dependencies first)
 * @throws CircularDependencyError when a circular reference is detected
 */
export function buildVariableDAG(
  variables: Array<{ name: string; query?: string }>,
): string[] {
  // Adjacency list: name → variables this one depends on
  const deps = new Map<string, Set<string>>()
  const allNames = new Set(variables.map((v) => v.name))

  for (const v of variables) {
    const refs = v.query ? parseRefs(v.query).refs : []
    // Only add edges for references to other known variables (excluding self-references)
    deps.set(v.name, new Set(refs.filter((r) => r !== v.name && allNames.has(r))))
  }

  // Kahn's algorithm
  const inDegree = new Map<string, number>()
  for (const name of allNames) inDegree.set(name, 0)

  // inDegree[v] = number of variables v depends on (city→country means inDegree[city]=1)
  for (const [name, dependsOn] of deps) {
    inDegree.set(name, dependsOn.size)
  }

  const queue: string[] = []
  for (const [name, deg] of inDegree) {
    if (deg === 0) queue.push(name)
  }

  const sorted: string[] = []
  while (queue.length > 0) {
    const node = queue.shift()!
    sorted.push(node)
    for (const [name, dependsOn] of deps) {
      if (dependsOn.has(node)) {
        const newDeg = (inDegree.get(name) ?? 0) - 1
        inDegree.set(name, newDeg)
        if (newDeg === 0) queue.push(name)
      }
    }
  }

  if (sorted.length !== allNames.size) {
    // Trace the cycle
    const remaining = [...allNames].filter((n) => !sorted.includes(n))
    detectCycle(remaining, deps)
    // detectCycle always throws, but keep a fallback for type safety
    throw new CircularDependencyError(remaining)
  }

  return sorted
}

/** Trace the cyclic path and throw CircularDependencyError */
function detectCycle(nodes: string[], deps: Map<string, Set<string>>): never {
  const visited = new Set<string>()
  const stack: string[] = []

  const dfs = (node: string): void => {
    if (stack.includes(node)) {
      const cycleStart = stack.indexOf(node)
      throw new CircularDependencyError([...stack.slice(cycleStart), node])
    }
    if (visited.has(node)) return
    visited.add(node)
    stack.push(node)
    for (const dep of deps.get(node) ?? []) {
      dfs(dep)
    }
    stack.pop()
  }

  for (const node of nodes) {
    dfs(node)
  }

  // Reaching here means no cycle was found (should be impossible)
  throw new CircularDependencyError(nodes)
}
