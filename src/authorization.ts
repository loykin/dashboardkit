import type {
  AuthContext,
  AuthorizationDecision,
  AuthorizationRequest,
  PermissionAction,
  PermissionRule,
} from './types'

// ─── Pure policy helpers ────────────────────────────────────────────────────────

export function rulesForAction(rules: PermissionRule[], action: PermissionAction): PermissionRule[] {
  return rules.filter((rule) => rule.action === action || rule.action === '*')
}

export function intersects(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (!left || left.length === 0) return true
  if (!right || right.length === 0) return false
  return left.some((value) => right.includes(value))
}

export function ruleMatches(rule: PermissionRule, ctx: AuthContext): boolean {
  const subject = ctx.subject
  if (rule.subjects && (!subject?.id || !rule.subjects.includes(subject.id))) return false
  if (!intersects(rule.roles, subject?.roles)) return false
  return intersects(rule.groups, subject?.groups)
}

export function defaultAuthorize(request: AuthorizationRequest): AuthorizationDecision {
  const matchingRules = rulesForAction(request.permissions, request.action)
  if (matchingRules.length === 0) return { allowed: true }

  const matched = matchingRules.filter((rule) => ruleMatches(rule, request.authContext))
  const deny = matched.find((rule) => rule.effect === 'deny')
  if (deny) return { allowed: false, reason: deny.reason ?? 'authorization denied' }

  const allow = matched.find((rule) => rule.effect === 'allow')
  if (allow) return { allowed: true }

  return { allowed: false, reason: 'authorization denied' }
}

// ─── Runtime factory ────────────────────────────────────────────────────────────

export interface CreateAuthorizationOptions {
  getAuthContext: () => AuthContext
  authorize?: (
    request: AuthorizationRequest,
  ) => boolean | AuthorizationDecision | Promise<boolean | AuthorizationDecision>
  onDenied: (action: PermissionAction, resourceId: string, reason: string) => void
}

export interface AuthorizationRuntime {
  authorize(request: Omit<AuthorizationRequest, 'authContext'>): Promise<AuthorizationDecision>
  ensureAuthorized(request: Omit<AuthorizationRequest, 'authContext'>): Promise<void>
}

export function createAuthorization(options: CreateAuthorizationOptions): AuthorizationRuntime {
  const { getAuthContext, authorize: customAuthorize, onDenied } = options

  async function authorize(
    request: Omit<AuthorizationRequest, 'authContext'>,
  ): Promise<AuthorizationDecision> {
    const fullRequest: AuthorizationRequest = { ...request, authContext: getAuthContext() }
    const decision = customAuthorize
      ? await customAuthorize(fullRequest)
      : defaultAuthorize(fullRequest)
    return typeof decision === 'boolean' ? { allowed: decision } : decision
  }

  async function ensureAuthorized(
    request: Omit<AuthorizationRequest, 'authContext'>,
  ): Promise<void> {
    const decision = await authorize(request)
    if (decision.allowed) return

    const resourceId =
      request.panel?.id ??
      request.variable?.name ??
      request.datasourceUid ??
      request.dashboard.id
    const reason = decision.reason ?? 'authorization denied'
    onDenied(request.action, resourceId, reason)
    throw new Error(reason)
  }

  return { authorize, ensureAuthorized }
}
