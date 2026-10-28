import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import * as net from 'net';
import { ChatGateway } from '../../chat/chat.gateway';

/**
 * After any successful write to student-visible content, tell every connected app
 * (socket event `content_updated` with `{ group }`) so open screens reload at once,
 * and bump the FastAPI hot-cache generation (`hot:gen:<group>`) so cached
 * `/api/courses`, `/api/banners/public`, … stop serving the old copy.
 *
 * A dedicated socket event (not `realtime_update`) on purpose: the web admin turns
 * every `realtime_update` into a toast.
 */
const GROUPS: Record<string, string> = {
  courses: 'courses',
  categories: 'courses',
  settings: 'settings',
  banners: 'banners',
  'app-reviews': 'app-reviews',
  blogs: 'blogs',
  events: 'events',
  'news-ticker': 'news',
  batches: 'batches',
  'booking-batches': 'batches',
  'batch-materials': 'materials',
  'free-materials': 'materials',
  timetables: 'schedule',
  'live-classes': 'schedule',
  exams: 'exams',
  questions: 'exams',
  assignments: 'assignments',
  'passed-students': 'showcase',
  placements: 'showcase',
  'google-reviews': 'showcase',
  'video-reviews': 'showcase',
  notifications: 'notifications',
};

/** Groups the FastAPI catalog cache keys on (python_service/hot_api/catalog.py). */
const HOT_CACHE_GROUPS = new Set(['courses', 'settings', 'banners', 'app-reviews']);

/** Student actions that write under a content route but change nothing others see. */
const IGNORED = [/\/like\b/, /\/reviews?\b/, /\/progress\b/, /\/submit/, /\/register-token\b/, /\/read\b/];

@Injectable()
export class ContentChangeInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ContentChangeInterceptor.name);

  constructor(private readonly gateway: ChatGateway) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next.handle();

    const path: string = (req.originalUrl || req.url || '').split('?')[0];
    const segment = path.replace(/^\/api\//, '').split('/')[0];
    const group = GROUPS[segment];
    if (!group || IGNORED.some((re) => re.test(path))) return next.handle();
    // Only staff edits change what everyone sees (students mark notifications read, etc.).
    const role = req.user?.role;
    if (role && role !== 'admin' && role !== 'teacher') return next.handle();

    return next.handle().pipe(tap(() => this.announce(group)));
  }

  private announce(group: string) {
    try {
      this.gateway.server?.emit('content_updated', { group, at: new Date().toISOString() });
    } catch (err) {
      this.logger.warn(`content_updated emit failed: ${(err as Error).message}`);
    }
    if (HOT_CACHE_GROUPS.has(group)) bumpHotCache(group);
  }
}

/** Fire-and-forget `INCR hot:gen:<group>` over raw RESP (no Redis client dependency). */
function bumpHotCache(group: string) {
  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = parseInt(process.env.REDIS_PORT || '6379', 10);
  const password = process.env.REDIS_PASSWORD;
  const cmd = (...args: string[]) => `*${args.length}\r\n${args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join('')}`;

  const socket = net.createConnection({ host, port });
  socket.setTimeout(2000);
  socket.on('connect', () => {
    socket.end((password ? cmd('AUTH', password) : '') + cmd('INCR', `hot:gen:${group}`));
  });
  socket.on('data', () => undefined);
  socket.on('timeout', () => socket.destroy());
  socket.on('error', () => undefined); // no Redis (local dev) → nothing cached to invalidate
}
