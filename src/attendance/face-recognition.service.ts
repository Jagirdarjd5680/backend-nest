import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require('sharp'); // its typings resolve to the ESM build here; the CJS runtime export is the function
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tf = require('@tensorflow/tfjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const wasm = require('@tensorflow/tfjs-backend-wasm');
// WASM build: pure JS + WebAssembly, so nothing native to compile on the server.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js');

/**
 * Euclidean distance at or below which two descriptors are the same person. face-api's usual
 * cut-off is 0.6; attendance uses a stricter 0.5 because marking the wrong student present is
 * worse than asking for a retake. Tunable with FACE_MATCH_THRESHOLD in .env.
 */
export const FACE_MATCH_THRESHOLD = Number(process.env.FACE_MATCH_THRESHOLD) || 0.5;
/** Big phone photos are shrunk first — detection doesn't need 4000px and it's much faster. */
const MAX_SIDE = 1024;

export interface FaceMatch {
  student_id: string;
  confidence: number;
}

/**
 * Face enrollment + recognition inside NestJS (formerly a separate Python service's /get-descriptor
 * and /recognize). SSD MobileNet finds faces, the 68-point landmarks align them and the
 * recognition net turns each into a 128-float descriptor; two descriptors closer than
 * FACE_MATCH_THRESHOLD belong to the same person. Models ship inside @vladmandic/face-api
 * and load once, on first use.
 */
@Injectable()
export class FaceRecognitionService {
  private readonly logger = new Logger('FaceRecognition');
  private ready: Promise<void> | null = null;

  private init() {
    this.ready ??= (async () => {
      const started = Date.now();
      const wasmDir = path.join(path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm')), path.sep);
      wasm.setWasmPaths(wasmDir); // local files via the WASM loader (fetch can't read disk paths)
      await tf.setBackend('wasm');
      await tf.ready();
      const modelDir = path.join(path.dirname(require.resolve('@vladmandic/face-api/dist/face-api.node-wasm.js')), '..', 'model');
      await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelDir);
      await faceapi.nets.faceLandmark68Net.loadFromDisk(modelDir);
      await faceapi.nets.faceRecognitionNet.loadFromDisk(modelDir);
      this.logger.log(`Face models ready on ${tf.getBackend()} in ${Date.now() - started}ms`);
    })().catch((err) => {
      this.ready = null; // let the next request retry
      throw err;
    });
    return this.ready;
  }

  /** Descriptors of every face in the photo (largest/clearest faces first). */
  private async detect(imageBase64: string, minConfidence = 0.5): Promise<Float32Array[]> {
    await this.init();
    const input = await this.decode(imageBase64);
    try {
      const results = await faceapi
        .detectAllFaces(input, new faceapi.SsdMobilenetv1Options({ minConfidence }))
        .withFaceLandmarks()
        .withFaceDescriptors();
      this.logger.debug(`detect: ${input.shape[1]}x${input.shape[0]} minConfidence=${minConfidence} faces=${results.length}`);
      return results
        .sort((a: any, b: any) => b.detection.box.area - a.detection.box.area)
        .map((r: any) => r.descriptor as Float32Array);
    } finally {
      input.dispose();
    }
  }

  /** One descriptor for enrollment — the biggest face in the photo. Null when no face is found. */
  async descriptor(imageBase64: string): Promise<number[] | null> {
    let faces = await this.detect(imageBase64);
    // Webcam enrollment frames are often dim/soft; one lenient retry before giving up.
    // Only the biggest face is kept, so the lower bar can't enroll a stray background face
    // over the student. Check-in (recognize) keeps the strict 0.5.
    if (!faces.length) faces = await this.detect(imageBase64, 0.3);
    return faces.length ? Array.from(faces[0]) : null;
  }

  /**
   * Matches each face in the frame against `known` (this batch's enrolled students only).
   * One result per recognised face; unknown faces are dropped.
   */
  async recognize(imageBase64: string, known: { id: string; descriptor: number[] }[]): Promise<FaceMatch[]> {
    const usable = known.filter((k) => Array.isArray(k.descriptor) && k.descriptor.length === 128);
    if (!usable.length) return [];
    const faces = await this.detect(imageBase64);
    this.logger.debug(`recognize: faces=${faces.length} candidates=${usable.length}`);

    const matches: FaceMatch[] = [];
    for (const face of faces) {
      let best = { id: '', distance: Infinity };
      for (const k of usable) {
        const d = faceapi.euclideanDistance(face, k.descriptor);
        if (d < best.distance) best = { id: k.id, distance: d };
      }
      if (best.distance <= FACE_MATCH_THRESHOLD) matches.push({ student_id: best.id, confidence: 1 - best.distance });
    }
    return matches;
  }

  /** base64 (optionally a data: URL) → RGB int32 tensor, EXIF-rotated and downscaled. */
  private async decode(imageBase64: string) {
    const raw = (imageBase64.includes(',') ? imageBase64.slice(imageBase64.indexOf(',') + 1) : imageBase64)
      .replace(/ /g, '+') // a URL-decoded '+' arrives as a space
      .replace(/[\r\n\t]/g, '');
    let pixels: { data: Buffer; info: { width: number; height: number; channels: number } };
    try {
      pixels = await sharp(Buffer.from(raw, 'base64'))
        .rotate() // honour the phone's EXIF orientation
        .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new BadRequestException('Could not read the photo — please capture it again.');
    }
    const { width, height, channels } = pixels.info;
    return tf.tensor3d(new Int32Array(pixels.data), [height, width, channels], 'int32');
  }
}
