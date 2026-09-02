import { Global, Module } from '@nestjs/common';
import { CredentialEncryptionService } from './credential-encryption.service';

@Global()
@Module({ providers: [CredentialEncryptionService], exports: [CredentialEncryptionService] })
export class SecretsModule {}
