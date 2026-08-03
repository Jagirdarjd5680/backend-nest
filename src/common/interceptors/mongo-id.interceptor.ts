import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class MongoIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map(data => this.transform(data))
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
      
      const newObj = { ...obj };
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
