import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { AppConfig } from './config';
import { compare } from 'bcryptjs';

const COOKIE_NAME = 'worldloom_session';
const SESSION_MS = 12 * 60 * 60 * 1000;
function equal(a: string, b: string) {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}

export class Auth {
  private sessions = new Map<string, { expires: number; userId: string }>();
  constructor(
    private config: AppConfig,
    private credentials?: () => { username: string; hash: string } | undefined,
    private loginRequired?: () => boolean,
  ) {}
  get required() {
    return this.loginRequired
      ? this.loginRequired()
      : Boolean(this.credentials?.() || this.config.password);
  }
  clearSessions(userId?: string) {
    if (!userId) this.sessions.clear();
    else
      for (const [id, session] of this.sessions)
        if (session.userId === userId) this.sessions.delete(id);
  }
  clearSecondarySessions() {
    for (const [id, session] of this.sessions)
      if (session.userId !== 'owner') this.sessions.delete(id);
  }
  private signature(id: string) {
    return createHmac('sha256', this.config.sessionSecret).update(id).digest('base64url');
  }
  private sessionId(req: Request) {
    const token = req.cookies?.[COOKIE_NAME];
    if (typeof token !== 'string' || token.length > 200) return undefined;
    const [id, signature] = token.split('.');
    if (!id || !signature || !equal(signature, this.signature(id))) return undefined;
    return id;
  }
  authenticated(req: Request) {
    if (!this.required) return true;
    const id = this.sessionId(req);
    if (!id) return false;
    const session = this.sessions.get(id);
    if (!session || session.expires < Date.now()) {
      this.sessions.delete(id);
      return false;
    }
    return true;
  }
  userId(req: Request): string | undefined {
    if (!this.authenticated(req)) return undefined;
    if (!this.required) return 'owner';
    return this.sessions.get(this.sessionId(req)!)?.userId;
  }
  async checkPassword(value: string, username?: string) {
    const account = this.credentials?.();
    if (account) {
      if (Buffer.byteLength(value, 'utf8') > 72) return false;
      const matches = await compare(value, account.hash);
      return Boolean(username && equal(username, account.username) && matches);
    }
    return !this.config.password || equal(value, this.config.password);
  }
  login(res: Response, userId = 'owner') {
    const now = Date.now();
    for (const [id, session] of this.sessions) if (session.expires < now) this.sessions.delete(id);
    // Sessions are intentionally process-local; restarting logs every browser out.
    if (this.sessions.size > 1000) this.sessions.delete(this.sessions.keys().next().value!);
    const id = randomBytes(32).toString('base64url');
    this.sessions.set(id, { expires: now + SESSION_MS, userId });
    res.cookie(COOKIE_NAME, `${id}.${this.signature(id)}`, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.secureCookies,
      maxAge: SESSION_MS,
      path: '/',
    });
  }
  logout(req: Request, res: Response) {
    const id = this.sessionId(req);
    if (id) this.sessions.delete(id);
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.secureCookies,
      path: '/',
    });
  }
}
