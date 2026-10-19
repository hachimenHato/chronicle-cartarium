import path from 'node:path';
import { BRAND_EN, UPDATE_PACKAGE_EXTENSION, PRIVATE_BACKUP_EXTENSION } from '../shared/branding';
import { mkdir, writeFile, access, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { AppConfig } from './config';
import { Auth } from './auth';
import { ConflictError, type WorkspaceStore } from './store';
import { saveSchema, workspaceDataSchema } from './validation';
import { InstallationManager, InstallationError } from './installation';
import { UserDirectoryStore } from './users';
import { ownerAccount, canExport, isAdministrator, type UserAccount } from '../shared/access';
import {
  PermissionError,
  requireOwner,
  requireAdministrator,
  visibleWorkspace,
  workspaceImages,
} from './permissions';
import { exportMarkdown } from '../src/lib/export';
import { APPLICATION_VERSION } from '../shared/application';
import { MaintenanceError, DataProtectionError } from './maintenance';
import { FullBackupService, digest } from './full-backup';
import { ProgramUpdateService } from './program-update';

export function imageExtension(buffer: Buffer): 'png' | 'jpg' | 'webp' | undefined {
  if (
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    buffer.toString('ascii', 12, 16) === 'IHDR' &&
    buffer.readUInt32BE(16) > 0 &&
    buffer.readUInt32BE(20) > 0
  )
    return 'png';
  if (
    buffer.length >= 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff &&
    buffer.at(-2) === 0xff &&
    buffer.at(-1) === 0xd9
  )
    return 'jpg';
  if (
    buffer.length >= 20 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP' &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('ascii', 12, 16))
  )
    return 'webp';
  return undefined;
}

export async function createApp(
  config: AppConfig,
  store: WorkspaceStore,
  onInstalled?: () => void,
  onShutdown?: () => void,
) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.secureCookies ? [] : null,
        },
      },
      strictTransportSecurity: config.secureCookies ? undefined : false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '16mb' }));
  const management = store instanceof InstallationManager ? store : undefined;
  const auth = new Auth(config, management ? () => management.credentials : undefined);
  const users = management
    ? await UserDirectoryStore.open(
        path.join(config.dataDir, 'users.json'),
        () => management.credentials,
        management.maintenance,
      )
    : undefined;
  const fullBackups = management && users ? new FullBackupService(management, users) : undefined;
  const updates = management ? new ProgramUpdateService(config) : undefined;
  const actor = (req: express.Request): UserAccount | undefined => {
    const id = auth.userId(req);
    return id ? (users ? users.actor(id) : { ...ownerAccount(), tourCompleted: true }) : undefined;
  };
  const uploadDir = path.join(config.dataDir, 'uploads');
  await mkdir(uploadDir, { recursive: true });
  const imageOwnerFile = path.join(uploadDir, '.owners.json');
  let imageOwners: Record<string, string> = Object.create(null);
  try {
    imageOwners = z
      .record(z.string().regex(/^\/uploads\/[A-Za-z0-9_-]+\.(png|jpg|webp)$/), z.string())
      .parse(JSON.parse(await readFile(imageOwnerFile, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // Same-site cookies plus origin checking protect authenticated writes. Reverse proxies must preserve Host.
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    const clientVersion = req.get('X-Chronicle-Cartarium-Client') || req.get('X-Worldloom-Client');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin) {
      try {
        if (new URL(origin).host !== req.get('host'))
          return res.status(403).json({ error: 'origin_rejected', message: '请求来源不匹配。' });
      } catch {
        return res.status(403).json({ error: 'origin_rejected', message: '请求来源无效。' });
      }
    }
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      ((clientVersion && clientVersion !== APPLICATION_VERSION) || (origin && !clientVersion))
    )
      return res.status(409).json({
        error: 'client_version_changed',
        message: '页面版本已更新，请先保留当前编辑内容，再刷新到新版后保存。',
      });
    next();
  });
  app.get('/api/status', (req, res) =>
    res.json({
      authenticated: management?.setupRequired ? false : Boolean(actor(req)),
      mode: store.mode,
      loginRequired: Boolean(management?.setupRequired || auth.required),
      ...(management
        ? {
            setupRequired: management.setupRequired,
            setupTokenRequired: Boolean(config.setupToken),
          }
        : {}),
      configuredStorage: management?.configuredStorage,
      settings: management?.settings,
      username: actor(req)?.username,
      actor: management?.setupRequired ? undefined : actor(req),
      multiUser: users?.enabled ?? false,
    }),
  );
  app.post(
    '/api/login',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skipSuccessfulRequests: true,
      message: { error: 'rate_limited', message: '登录尝试过多，请 15 分钟后重试。' },
    }),
    async (req, res) => {
      const parsed = z
        .object({ password: z.string().max(1024), username: z.string().max(40).optional() })
        .strict()
        .safeParse(req.body);
      const userId =
        parsed.success && !management?.setupRequired
          ? users
            ? await users.authenticate(parsed.data.username ?? '', parsed.data.password)
            : (await auth.checkPassword(parsed.data.password, parsed.data.username))
              ? 'owner'
              : undefined
          : undefined;
      if (management?.setupRequired || !parsed.success || !userId)
        return res.status(401).json({ error: 'invalid_password', message: '用户名或密码不正确。' });
      auth.login(res, userId);
      return res.json({ authenticated: true });
    },
  );
  app.post('/api/logout', (req, res) => {
    auth.logout(req, res);
    res.json({ authenticated: false });
  });
  app.post(
    '/api/install',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
    async (req, res) => {
      if (!management || !management.setupRequired)
        return res.status(409).json({ message: '安装已完成，不能重复配置。' });
      // Reverse proxies/containers can bootstrap with an explicit secret. Otherwise
      // require both an actual loopback peer and localhost Host, never forwarded IP alone.
      const supplied =
        req.get('X-Chronicle-Cartarium-Setup-Token') || req.get('X-Worldloom-Setup-Token') || '';
      const tokenMatches =
        config.setupToken &&
        timingSafeEqual(
          createHash('sha256').update(supplied).digest(),
          createHash('sha256').update(config.setupToken).digest(),
        );
      if (
        config.setupToken
          ? !tokenMatches
          : !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '') ||
            !['localhost', '127.0.0.1', '[::1]'].includes(req.hostname)
      )
        return res.status(403).json({
          message: config.setupToken
            ? '安装授权码不正确。'
            : '请在服务器本机或通过 SSH 本地隧道打开安装指引。',
        });
      const result = await management.install(req.body);
      auth.login(res);
      res.status(201).json(result);
      onInstalled?.();
    },
  );
  const requireAuth: express.RequestHandler = (req, res, next) => {
    if (management?.setupRequired)
      return res.status(403).json({ error: 'setup_required', message: '请先完成安装指引。' });
    if (!actor(req))
      return res.status(401).json({ error: 'unauthorized', message: '请先登录工作台。' });
    next();
  };
  app.use('/api', requireAuth);
  app.get('/api/workspace', async (req, res) => {
    const envelope = await store.read();
    res.json({ ...envelope, data: visibleWorkspace(envelope.data, actor(req)!) });
  });
  app.put('/api/workspace', async (req, res) => {
    const { data, revision } = z
      .object({ data: workspaceDataSchema, revision: z.number().int().nonnegative() })
      .strict()
      .parse(req.body);
    const principal = actor(req)!;
    if (!isAdministrator(principal)) {
      const visible = workspaceImages(visibleWorkspace((await store.read()).data, principal));
      for (const image of workspaceImages(data))
        if (!visible.has(image) && imageOwners[image] !== principal.id)
          throw new PermissionError('没有使用此图片的权限。');
    }
    const saved = management
      ? await management.saveAuthorized(
          data,
          revision,
          () => {
            const current = actor(req);
            if (!current) throw new PermissionError('当前账户已停用或权限已变化，请重新登录。');
            return current;
          },
          (before, current) => {
            if (!isAdministrator(current)) {
              const visible = workspaceImages(visibleWorkspace(before, current));
              for (const image of workspaceImages(data))
                if (!visible.has(image) && imageOwners[image] !== current.id)
                  throw new PermissionError('没有使用此图片的权限。');
            }
          },
        )
      : await store.save(data, revision);
    const latest = actor(req);
    if (!latest) throw new PermissionError('账户已停用，请重新登录。');
    res.json({ ...saved, data: visibleWorkspace(saved.data, latest) });
  });
  app.post('/api/export', async (req, res) => {
    const principal = actor(req)!;
    if (!canExport(principal)) throw new PermissionError('当前账户没有导出世界档案的权限。');
    const options = z
      .object({
        worldId: z.string(),
        entityIds: z.array(z.string()).max(20_000),
        includeMaps: z.boolean(),
        includeRelations: z.boolean(),
        includePlots: z.boolean(),
        includeSessions: z.boolean(),
        includeSecrets: z.boolean(),
      })
      .strict()
      .parse(req.body);
    res.json({
      markdown: exportMarkdown(visibleWorkspace((await store.read()).data, principal), options),
    });
  });
  app.get('/api/backup', async (req, res) => {
    requireOwner(actor(req)!);
    res.json(await store.read());
  });
  app.put('/api/backup', async (req, res) => {
    requireOwner(actor(req)!);
    const input = saveSchema.parse(req.body);
    res.json(await store.save(input.data, input.revision));
  });
  if (management) {
    let updateRelease: (() => void) | undefined;
    app.post(
      ['/_chronicle-cartarium/update/:action', '/_worldloom/update/:action'],
      async (req, res) => {
        const input = z
          .object({ token: z.string().min(1) })
          .strict()
          .parse(req.body);
        if (
          !config.updaterToken ||
          !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '') ||
          !timingSafeEqual(
            createHash('sha256').update(input.token).digest(),
            createHash('sha256').update(config.updaterToken).digest(),
          )
        )
          return res.status(401).json({ error: 'runner_required' });
        if (req.params.action === 'backup') {
          updateRelease = await management.maintenance.acquire();
          try {
            const before = await management.read();
            return res.json(await fullBackups!.create(before.revision, true));
          } catch (error) {
            updateRelease();
            updateRelease = undefined;
            throw error;
          }
        }
        if (req.params.action === 'release') {
          updateRelease?.();
          updateRelease = undefined;
          // Startup hold belongs to this process and is released after the protected health check.
          if (management.maintenance.busy) management.maintenance.releaseStartupHold();
          return res.json({ released: true });
        }
        if (req.params.action === 'health') {
          const saved = await management.read();
          return res.json({
            digest: digest(saved.data),
            revision: saved.revision,
            installation: await management.privateFingerprint(),
            users: await users!.privateFingerprint(),
          });
        }
        if (req.params.action === 'shutdown' && onShutdown) {
          res.json({ shuttingDown: true });
          setTimeout(onShutdown, 100).unref();
          return;
        }
        return res.status(404).json({ error: 'unknown_action' });
      },
    );
    app.get('/api/admin/updates', async (req, res) => {
      requireOwner(actor(req)!);
      res.json(await updates!.status());
    });
    const updateIncoming = path.join(updates!.root, 'incoming');
    const updateUpload = multer({
      storage: multer.diskStorage({
        destination: (_req, _file, callback) => {
          void mkdir(updateIncoming, { recursive: true, mode: 0o700 }).then(
            () => callback(null, updateIncoming),
            (error) => callback(error, updateIncoming),
          );
        },
        filename: (_req, _file, callback) =>
          callback(null, randomUUID() + UPDATE_PACKAGE_EXTENSION),
      }),
      limits: { fileSize: 128 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
    });
    app.post(
      '/api/admin/updates/package',
      (req, _res, next) => {
        try {
          requireOwner(actor(req)!);
          next();
        } catch (error) {
          next(error);
        }
      },
      updateUpload.single('file'),
      async (req, res) => {
        if (!req.file) throw new InstallationError('请选择官方更新包。');
        try {
          res.json(await updates!.prepare(req.file.path));
        } catch {
          throw new InstallationError('更新包签名、版本、平台或文件校验未通过，原程序和数据保留。');
        } finally {
          await unlink(req.file.path).catch(() => undefined);
        }
      },
    );
    app.post('/api/admin/updates/apply', async (req, res) => {
      requireOwner(actor(req)!);
      const input = z.object({ packageId: z.string() }).strict().parse(req.body);
      res.json(await updates!.apply(input.packageId));
    });
    app.get('/api/admin/full-backups', async (req, res) => {
      requireOwner(actor(req)!);
      res.json(await fullBackups!.status());
    });
    app.post('/api/admin/full-backups', async (req, res) => {
      requireOwner(actor(req)!);
      const input = z
        .object({ revision: z.number().int().nonnegative().safe() })
        .strict()
        .parse(req.body);
      res.json(await fullBackups!.create(input.revision));
    });
    app.post(
      '/api/admin/full-backups/:id/download',
      rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 10,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: 'rate_limited', message: '私有备份下载确认过于频繁，请稍后重试。' },
      }),
      async (req, res) => {
        requireOwner(actor(req)!);
        const input = z
          .object({ password: z.string().min(1).max(1024) })
          .strict()
          .parse(req.body);
        if (!(await management.verifyOwnerPassword(input.password)))
          throw new InstallationError('请使用主管理员当前密码确认私有备份下载。', 401);
        const filename = await fullBackups!.archive(String(req.params.id));
        res.download(
          filename,
          `${req.params.id}${PRIVATE_BACKUP_EXTENSION}`,
          { dotfiles: 'allow' },
          (error) => {
            void unlink(filename).catch(() => undefined);
            if (error && !res.headersSent)
              res
                .status(500)
                .json({ error: 'backup_download_failed', message: '备份下载未完成，请重试。' });
          },
        );
      },
    );
    app.get('/api/admin', async (req, res) => {
      requireAdministrator(actor(req)!);
      return res.json({
        settings: management.settings,
        username: management.credentials?.username,
        storage: management.mode,
        version: APPLICATION_VERSION,
        node: process.versions.node,
        platform: process.platform,
      });
    });
    app.put('/api/admin/settings', async (req, res) => {
      requireOwner(actor(req)!);
      res.json(await management.updateSettings(req.body));
    });
    app.post('/api/admin/password', async (req, res) => {
      requireOwner(actor(req)!);
      await management.changePassword(req.body);
      auth.clearSessions();
      auth.login(res);
      res.json({ changed: true });
    });
    app.post('/api/admin/reset', async (req, res) => {
      requireOwner(actor(req)!);
      res.json(await management.reset(req.body));
    });
    app.post('/api/account/password', async (req, res) => {
      const principal = actor(req)!;
      if (principal.role === 'owner') await management.changePassword(req.body);
      else await users!.changePassword(principal.id, req.body);
      auth.clearSessions(principal.id);
      auth.login(res, principal.id);
      res.json({ changed: true });
    });
    app.post('/api/account/tour', async (req, res) => {
      z.object({ completed: z.literal(true) })
        .strict()
        .parse(req.body);
      res.json(await users!.completeTour(actor(req)!.id));
    });
    app.get('/api/admin/users', async (req, res) => {
      requireAdministrator(actor(req)!);
      res.json(await users!.read());
    });
    app.put('/api/admin/users/mode', async (req, res) => {
      const input = z
        .object({ enabled: z.boolean(), revision: z.number().int().nonnegative() })
        .strict()
        .parse(req.body);
      res.json(await users!.setEnabled(actor(req)!, input.enabled, input.revision));
    });
    app.put('/api/admin/users', async (req, res) => {
      requireAdministrator(actor(req)!);
      const data = (await store.read()).data;
      const ids = new Set(
        [
          ...data.entities,
          ...data.maps,
          ...data.relations,
          ...data.plots,
          ...data.sessions,
          ...data.variables,
        ].map((r) => r.id),
      );
      const result = await users!.write(actor(req)!, req.body, ids);
      if (req.body.id && (req.body.password || req.body.disabled)) auth.clearSessions(req.body.id);
      res.json(result);
    });
    app.delete('/api/admin/users/:id', async (req, res) => {
      const input = z.object({ revision: z.number().int().nonnegative() }).strict().parse(req.body);
      const id = String(req.params.id);
      res.json(await users!.remove(actor(req)!, id, input.revision));
      auth.clearSessions(id);
    });
  }
  const uploader = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  });
  app.post(
    '/api/uploads',
    rateLimit({
      windowMs: 60 * 1000,
      limit: 30,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'rate_limited', message: '上传过于频繁，请稍后重试。' },
    }),
    uploader.single('file'),
    async (req, res) => {
      const principal = actor(req)!;
      if (
        !isAdministrator(principal) &&
        !Object.values(principal.grants).some((g) => g.create || g.update !== 'none') &&
        !Object.values(principal.records).some((g) => g.update)
      )
        throw new PermissionError('当前账户没有上传图片的权限。');
      if (!req.file)
        return res.status(400).json({ error: 'file_required', message: '请选择图片。' });
      const extension = imageExtension(req.file.buffer);
      const expectedMime = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
      if (!extension || req.file.mimetype !== expectedMime)
        return res.status(415).json({
          error: 'unsupported_image',
          message: '仅支持内容有效的 PNG、JPEG 或 WebP 图片。',
        });
      const filename = `${randomUUID()}.${extension}`;
      const write = async () => {
        await writeFile(path.join(uploadDir, filename), req.file!.buffer, {
          flag: 'wx',
          mode: 0o600,
        });
        const next = { ...imageOwners, [`/uploads/${filename}`]: principal.id };
        const temporary = `${imageOwnerFile}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600 });
        await rename(temporary, imageOwnerFile);
        imageOwners = next;
      };
      if (management) await management.upload(write);
      else await write();
      return res.status(201).json({ url: `/uploads/${filename}` });
    },
  );
  app.use(
    '/uploads',
    requireAuth,
    async (req, _res, next) => {
      const principal = actor(req)!;
      const url = `/uploads${req.path}`;
      if (
        !isAdministrator(principal) &&
        imageOwners[url] !== principal.id &&
        !workspaceImages(visibleWorkspace((await store.read()).data, principal)).has(url)
      )
        throw new PermissionError('没有查看此图片的权限。');
      next();
    },
    (_req, res, next) => {
      res.setHeader('Cache-Control', 'private, no-cache');
      next();
    },
    express.static(uploadDir, { dotfiles: 'deny', index: false, fallthrough: false }),
  );
  app.use('/api', (_req, res) =>
    res.status(404).json({ error: 'not_found', message: '接口不存在。' }),
  );
  try {
    await access(path.join(config.distDir, 'index.html'));
    // The fixed version URL must never be cached or fall back to the SPA HTML.
    app.get('/app-version.json', (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(
        'app-version.json',
        { root: config.distDir, dotfiles: 'deny', cacheControl: false },
        (error) => {
          if (error) next(error);
        },
      );
    });
    app.use(
      express.static(config.distDir, {
        index: false,
        maxAge: config.production ? '1h' : 0,
        setHeaders(res, filename) {
          if (path.basename(filename) === 'index.html') res.setHeader('Cache-Control', 'no-store');
        },
      }),
    );
    app.get('/{*path}', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile('index.html', { root: config.distDir, dotfiles: 'deny' });
    });
  } catch {
    app.get('/', (_req, res) =>
      res.json({
        app: BRAND_EN,
        message:
          'Development frontend: http://localhost:5173. Build with npm run build to serve the app here.',
      }),
    );
  }
  const errors: ErrorRequestHandler = (err, req, res, _next) => {
    if (err instanceof DataProtectionError) {
      res.status(422).json({ error: 'data_protection', message: err.message });
      return;
    }
    if (err instanceof MaintenanceError) {
      res.status(503).json({ error: 'maintenance', message: err.message });
      return;
    }
    if (err instanceof PermissionError) {
      res.status(403).json({ error: 'permission_denied', message: err.message });
      return;
    }
    if (err instanceof InstallationError) {
      res.status(err.status).json({ error: 'installation_error', message: err.message });
      return;
    }
    if (err instanceof ConflictError) {
      res.status(409).json({ error: 'revision_conflict', message: err.message });
      return;
    }
    if (err instanceof z.ZodError) {
      res.status(400).json({
        error: 'validation_failed',
        message: '内容格式或关联关系无效。',
        issues: err.issues
          .slice(0, 30)
          .map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
      return;
    }
    if (err instanceof multer.MulterError) {
      const programPackage = req.path === '/api/admin/updates/package';
      res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
        error: err.code,
        message:
          err.code === 'LIMIT_FILE_SIZE'
            ? programPackage
              ? '程序更新包不能超过 128 MB。'
              : '图片不能超过 8 MB。'
            : programPackage
              ? '请仅上传一个程序更新包。'
              : '上传格式无效，请仅上传一张图片。',
      });
      return;
    }
    if (err.type === 'entity.too.large') {
      res.status(413).json({ error: 'payload_too_large', message: '工作区内容不能超过 16 MB。' });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'invalid_json', message: 'JSON 格式无效。' });
      return;
    }
    if (err.status === 404) {
      res.status(404).json({ error: 'not_found', message: '文件不存在。' });
      return;
    }
    // Do not log error messages from the driver: they may contain SQL data or credentials.
    console.error('[request_failed]', err.name || 'Error', err.code || 'unknown');
    res
      .status(500)
      .json({ error: 'internal_error', message: '保存或读取失败，请检查服务端日志和数据库连接。' });
  };
  app.use(errors);
  return app;
}
