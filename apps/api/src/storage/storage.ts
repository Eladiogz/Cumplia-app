import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  type ServerSideEncryption,
} from "@aws-sdk/client-s3";

/**
 * Almacenamiento de archivos (evidencia). Las claves las arma siempre la API
 * (`org/<organización>/...`): nunca un nombre que venga del usuario.
 */
export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** null si el objeto no existe. */
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Para servicios compatibles (SeaweedFS en desarrollo, Cloudflare R2, Backblaze…). */
  endpoint?: string;
  /** Rutas tipo `host/bucket/clave` (necesario en la mayoría de los servicios compatibles). */
  forcePathStyle?: boolean;
  /** Cifrado del lado del servidor (p. ej. "AES256" en AWS). */
  serverSideEncryption?: ServerSideEncryption;
}

export function createS3Storage(config: S3Config): ObjectStorage & { ensureBucket(create: boolean): Promise<void> } {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  const Bucket = config.bucket;

  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ...(config.serverSideEncryption ? { ServerSideEncryption: config.serverSideEncryption } : {}),
        }),
      );
    },
    async get(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        return res.Body ? Buffer.from(await res.Body.transformToByteArray()) : null;
      } catch (e) {
        if (e instanceof NoSuchKey) return null;
        throw e;
      }
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    /** Verifica que el bucket exista; en desarrollo lo crea si falta. */
    async ensureBucket(create) {
      try {
        await client.send(new HeadBucketCommand({ Bucket }));
      } catch (e) {
        if (!create) throw new Error(`No se puede acceder al bucket "${Bucket}": ${(e as Error).message}`);
        await client.send(new CreateBucketCommand({ Bucket }));
      }
    },
  };
}

/** Tests: guarda los objetos en memoria. */
export class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async put(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType });
  }

  async get(key: string) {
    return this.objects.get(key)?.body ?? null;
  }

  async delete(key: string) {
    this.objects.delete(key);
  }
}
