import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Never sent to any client, at any depth. Services often `include: { user: true }` or return the
 * JWT user as-is, which carried the password hash and the password-reset token (= account
 * takeover) to whoever could read the row. Stripping here covers every route, present and future.
 */
const SECRET_KEYS = new Set([
  'password',
  'passwordResetToken',
  'passwordResetExpiry',
  'faceDescriptor',
  'expoPushToken',
  'jti',
  'tokenId',
  'razorpaySignature',
]);

@Injectable()
export class MongoIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // Handlers using @Res() may hand back the Express response object itself (res.send() returns
    // it). That object is circular — walking it blew the stack. Once the reply is already sent
    // there is nothing to transform anyway.
    const res = context.switchToHttp().getResponse();
    return next.handle().pipe(
      map(data => (res?.headersSent ? data : this.transform(data)))
    );
  }

  private transform(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.transform(item));
    }

    if (typeof obj === 'object') {
      if (obj instanceof Date) {
        return obj;
      }
      
      // Buffers (file downloads) and other class instances pass through untouched.
      if (Buffer.isBuffer(obj) || obj instanceof Uint8Array) {
        return obj;
      }

      const newObj = { ...obj };
      for (const key of SECRET_KEYS) delete newObj[key];
      if ('id' in newObj && !('_id' in newObj)) {
        newObj._id = newObj.id;
      }
      
      for (const key of Object.keys(newObj)) {
        if (typeof newObj[key] === 'object') {
          newObj[key] = this.transform(newObj[key]);
        }
      }
      return newObj;
    }

    return obj;
  }
}
