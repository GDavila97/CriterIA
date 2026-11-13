const PRIVATE_PREFIXES = ['/analisis', '/historial', '/ajustes'];

export function isPrivatePath(pathname: string): boolean {
  return PRIVATE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
