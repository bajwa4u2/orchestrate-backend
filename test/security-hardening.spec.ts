import 'reflect-metadata';
import assert from 'assert';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { CreatePublicIntakeDto } from '../src/intake/dto/create-public-intake.dto';
import { ReplyIntakeDto } from '../src/intake/dto/reply-intake.dto';
import { SupportCaseService } from '../src/support/support-case.service';
import { RepliesController } from '../src/replies/replies.controller';
import { AccessContextService } from '../src/access-context/access-context.service';

async function expectRejectsWith(
  action: () => Promise<unknown>,
  errorType: new (...args: any[]) => Error,
) {
  let thrown: unknown;
  try {
    await action();
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof errorType, `Expected ${errorType.name}, got ${String(thrown)}`);
}

async function testPublicIntakeValidation() {
  const invalid = plainToInstance(CreatePublicIntakeDto, {
    message: '',
    email: 'not-an-email',
    sourcePage: 'x'.repeat(241),
    inquiryTypeHint: 'raw_internal_mode',
  });
  const invalidErrors = await validate(invalid);
  assert(invalidErrors.length >= 4, 'invalid public intake should fail multiple validation rules');

  const valid = plainToInstance(CreatePublicIntakeDto, {
    message: 'I need help understanding pricing.',
    email: 'client@example.com',
    sourcePage: '/pricing',
    inquiryTypeHint: 'pricing',
  });
  assert.strictEqual((await validate(valid)).length, 0, 'valid public intake should pass DTO validation');

  const reply = plainToInstance(ReplyIntakeDto, {
    message: '',
    sessionToken: 'x'.repeat(161),
  });
  assert((await validate(reply)).length >= 2, 'reply DTO should enforce message and token limits');
}

async function testCrossClientSupportReplyRejection() {
  const repo = {
    getBySessionId: async () => ({
      id: 'inq_1',
      sourceKind: 'CLIENT',
      clientId: 'client_a',
      email: 'client@example.com',
      followUpStateJson: { history: [] },
    }),
    appendInboundReply: async () => {
      throw new Error('append should not run for cross-client access');
    },
    hashPublicSessionToken: (token: string) => `hash:${token}`,
  };

  const service = new SupportCaseService(repo as any);
  await expectRejectsWith(
    () => service.appendInboundReply('sess_1', 'hello', { clientId: 'client_b' }),
    ForbiddenException,
  );
}

async function testPublicSupportTokenRejection() {
  const repo = {
    getBySessionId: async () => ({
      id: 'inq_1',
      sourceKind: 'PUBLIC',
      clientId: null,
      email: 'visitor@example.com',
      followUpStateJson: { history: [] },
      metadataJson: { intake: { publicSessionTokenHash: 'hash:correct' } },
    }),
    appendInboundReply: async () => {
      throw new Error('append should not run without public token ownership');
    },
    hashPublicSessionToken: (token: string) => `hash:${token}`,
  };

  const service = new SupportCaseService(repo as any);
  await expectRejectsWith(
    () => service.appendInboundReply('sess_1', 'hello', {}),
    UnauthorizedException,
  );
  await expectRejectsWith(
    () => service.appendInboundReply('sess_1', 'hello', { publicSessionToken: 'wrong' }),
    ForbiddenException,
  );
}

async function testWebhookSecretEnforcement() {
  const previousSecret = process.env.INBOUND_REPLY_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  delete process.env.INBOUND_REPLY_SECRET;

  const controller = new RepliesController(
    { ingestInboundReply: async () => ({ ok: true }) } as any,
    {} as any,
  );

  await expectRejectsWith(
    () => controller.ingestInbound({}, {
      fromEmail: 'sender@example.com',
      bodyText: 'reply',
    }),
    UnauthorizedException,
  );

  process.env.INBOUND_REPLY_SECRET = previousSecret;
  process.env.NODE_ENV = previousNodeEnv;
}

async function testOperatorAndClientAuthRejection() {
  const access = new AccessContextService({} as any);
  await expectRejectsWith(() => access.requireClient({}), UnauthorizedException);
  await expectRejectsWith(() => access.requireOperator({}), UnauthorizedException);
}

async function main() {
  await testPublicIntakeValidation();
  await testCrossClientSupportReplyRejection();
  await testPublicSupportTokenRejection();
  await testWebhookSecretEnforcement();
  await testOperatorAndClientAuthRejection();
  console.log('security-hardening tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
