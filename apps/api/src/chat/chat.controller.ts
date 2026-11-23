import { Body, Controller, HttpException, HttpStatus, Post, Res } from '@nestjs/common';
import type { Response } from 'express';

import { ModelClient, ModelError } from '@displayer/agent';
import {
  CHAT_MAX_MEDIA_BYTES,
  validateChatRequest,
  type ChatMedia,
  type ChatResponse,
  type DescribeResponse,
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
   * Caption or transcribe one attachment, before it joins the conversation.
   *
   * Not part of `POST /chat` because the answer is shown to the person first:
   * they get to see what the model heard or saw while the file is still just an
   * attachment, and their next message can rely on that text.
   */
  @Post('describe')
  async describe(@Body() body: unknown): Promise<DescribeResponse> {
    const validation = validateDescribeRequest(body);
    if (!validation.ok) throw new ChatValidationError(validation.issues);
    return this.chat.describe(validation.value.media, validation.value.kind);
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
            message:
              'The local LFM3-Omni server is not running. Start it with start_lfm3.bat in LFM3_OMNI_ROOT.',
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

type DescribeValidation =
  | {
      readonly ok: true;
      readonly value: { readonly media: ChatMedia; readonly kind: 'image' | 'audio' };
    }
  | { readonly ok: false; readonly issues: readonly FieldIssue[] };

const DATA_URL_PREFIX = /^data:[^;]+;base64,/i;

function validateDescribeRequest(input: unknown): DescribeValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, issues: [{ path: '', message: 'Expected a JSON object.' }] };
  }
  const record = input as Record<string, unknown>;
  const kind = record['kind'];
  const media = record['media'];
  const issues: FieldIssue[] = [];

  if (kind !== 'image' && kind !== 'audio') {
    issues.push({ path: 'kind', message: 'Kind must be image or audio.' });
  }
  let parsed: ChatMedia | undefined;
  if (typeof media !== 'object' || media === null || Array.isArray(media)) {
    issues.push({ path: 'media', message: 'Expected a media object.' });
  } else {
    const entry = media as Record<string, unknown>;
    const mimeType = entry['mimeType'];
    const data = entry['data'];
    if (typeof mimeType !== 'string' || mimeType.length === 0) {
      issues.push({ path: 'media.mimeType', message: 'MIME type is required.' });
    }
    if (typeof data !== 'string' || data.length === 0) {
      issues.push({ path: 'media.data', message: 'Base64 data is required.' });
    } else if (DATA_URL_PREFIX.test(data)) {
      issues.push({
        path: 'media.data',
        message: 'Send base64 payloads without a data-URL prefix.',
      });
    } else if (Math.floor((data.length * 3) / 4) > CHAT_MAX_MEDIA_BYTES) {
      issues.push({
        path: 'media.data',
        message: `Each file must be at most ${CHAT_MAX_MEDIA_BYTES / (1024 * 1024)} MB.`,
      });
    } else if (typeof mimeType === 'string' && mimeType.length > 0) {
      parsed = { mimeType, data };
    }
  }
  if (issues.length > 0 || !parsed || (kind !== 'image' && kind !== 'audio')) {
    return { ok: false, issues };
  }
  return { ok: true, value: { media: parsed, kind } };
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
