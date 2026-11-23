import { Body, Controller, HttpException, HttpStatus, Post, Res } from '@nestjs/common';
import type { Response } from 'express';

import { ModelClient, ModelError } from '@displayer/agent';
import {
  validateChatRequest,
  type ChatResponse,
  type FieldIssue,
  type SpeechRequest,
} from '@displayer/shared';

import { ChatService } from './chat.service.js';

@Controller('chat')
export class ChatController {
  private readonly speech: ModelClient;

  constructor(private readonly chat: ChatService) {
    this.speech = new ModelClient({
      ...(process.env['MODEL_BASE_URL'] ? { baseUrl: process.env['MODEL_BASE_URL'] } : {}),
    });
  }

  @Post()
  async reply(@Body() body: unknown): Promise<ChatResponse> {
    const validation = validateChatRequest(body);
    if (!validation.ok) throw new ChatValidationError(validation.issues);
    return this.chat.reply(validation.value);
  }

  /**
   * Speech is a separate endpoint because LFM3-Omni ignores `modalities` on a
   * chat completion: it always answers in text and audio must be requested
   * explicitly. The browser therefore asks for audio only for turns it plays.
   */
  @Post('speech')
  async speechFor(@Body() body: unknown, @Res() response: Response): Promise<void> {
    const validation = validateSpeechRequest(body);
    if (!validation.ok) throw new ChatValidationError(validation.issues);

    try {
      const audio = await this.speech.speak(validation.value.text, {
        voice: validation.value.voice ?? 'female',
        format: validation.value.format ?? 'wav',
      });
      response
        .status(200)
        .type(validation.value.format === 'mp3' ? 'audio/mpeg' : 'audio/wav')
        .send(Buffer.from(audio));
    } catch (error) {
      if (error instanceof ModelError && error.kind === 'unreachable') {
        throw new HttpException(
          {
            message: 'The local LFM3-Omni server is not running. Start it with scripts/serve.ps1.',
            details: [],
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw error;
    }
  }
}

/** An HttpException so the global filter renders it as VALIDATION_FAILED. */
export class ChatValidationError extends HttpException {
  constructor(issues: readonly FieldIssue[]) {
    super({ message: 'The chat request is invalid.', details: issues }, HttpStatus.BAD_REQUEST);
    this.name = 'ChatValidationError';
  }
}

type SpeechValidation =
  | { readonly ok: true; readonly value: SpeechRequest }
  | {
      readonly ok: false;
      readonly issues: readonly FieldIssue[];
    };

const SPEECH_TEXT_MAX = 4_000;

function validateSpeechRequest(input: unknown): SpeechValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, issues: [{ path: '', message: 'Expected a JSON object.' }] };
  }
  const record = input as Record<string, unknown>;
  const text = record['text'];
  const voice = record['voice'];
  const format = record['format'];
  const issues: FieldIssue[] = [];

  if (typeof text !== 'string' || text.trim().length === 0) {
    issues.push({ path: 'text', message: 'Text is required.' });
  } else if (text.length > SPEECH_TEXT_MAX) {
    issues.push({ path: 'text', message: `Text must be at most ${SPEECH_TEXT_MAX} characters.` });
  }
  if (voice !== undefined && voice !== 'female' && voice !== 'male') {
    issues.push({ path: 'voice', message: 'Voice must be female or male.' });
  }
  if (format !== undefined && format !== 'wav' && format !== 'mp3') {
    issues.push({ path: 'format', message: 'Format must be wav or mp3.' });
  }
  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    value: {
      text: (text as string).trim(),
      ...(voice === 'male' || voice === 'female' ? { voice } : {}),
      ...(format === 'wav' || format === 'mp3' ? { format } : {}),
    },
  };
}
