import { nodeProfile, resolveNodePrincipal } from "./principal";

export async function resolveRequestProfile(jwt: any, request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (token) {
    const profile = await jwt.verify(token);
    if (profile) return profile;
  }

  return nodeProfile(await resolveNodePrincipal(request));
}

export function canUseNodeCapability(profile: any, capability: string): boolean {
  return profile?.role !== "node" || Array.isArray(profile.capabilities) && profile.capabilities.includes(capability);
}