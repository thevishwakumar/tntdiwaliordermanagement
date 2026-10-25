// Type definitions for Supabase Edge Functions (Deno runtime)
// Provides clean IDE autocompletion and eliminates TypeScript diagnostic errors.

declare namespace Deno {
  export interface Env {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
    toObject(): Record<string, string>;
  }
  export const env: Env;
  export function serve(
    handler: (req: Request) => Promise<Response> | Response,
    options?: { port?: number; hostname?: string; onListen?: (params: { port: number; hostname: string }) => void }
  ): void;
}

declare module "https://deno.land/std@0.177.0/http/server.ts" {
  export function serve(
    handler: (req: Request) => Promise<Response> | Response,
    options?: { port?: number; hostname?: string }
  ): void;
}

declare module "https://esm.sh/@supabase/supabase-js@2.39.7" {
  export function createClient(
    supabaseUrl: string,
    supabaseKey: string,
    options?: any
  ): any;
}

declare module "https://deno.land/x/hmac@v2.0.1/mod.ts" {
  export function hmac(
    algorithm: string,
    key: string | Uint8Array,
    message: string | Uint8Array,
    inputEncoding?: string,
    outputEncoding?: string
  ): string;
}

declare module "https://*" {
  const content: any;
  export default content;
  export const serve: any;
  export const createClient: any;
  export const hmac: any;
}
