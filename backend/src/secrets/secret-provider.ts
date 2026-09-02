export interface SecretProvider {
  resolve(secretReference: string): string;
}

export const SECRET_PROVIDER = Symbol('SECRET_PROVIDER');
