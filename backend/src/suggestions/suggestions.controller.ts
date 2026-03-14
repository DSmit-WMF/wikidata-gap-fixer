import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Session,
} from '@nestjs/common';
import { ReasonCategory } from '../database/entities/suggestion-action.entity';
import type { SuggestionStatus, SuggestionType } from '../database/entities/suggestion.entity';
import { SuggestionsService } from './suggestions.service';

interface SessionUser {
  username: string;
  accessToken: string;
}

@Controller('api/suggestions')
export class SuggestionsController {
  constructor(private readonly service: SuggestionsService) {}

  @Get('pipeline/status')
  getPipelineStatus() {
    return this.service.getPipelineStatus();
  }

  @Get()
  async list(
    @Query('status') status?: SuggestionStatus,
    @Query('type') suggestionType?: SuggestionType,
    @Query('lang') languageCode?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll({
      status: status ?? 'pending',
      suggestionType,
      languageCode,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post(':id/accept')
  @HttpCode(200)
  async accept(@Param('id') id: string, @Session() session: Record<string, unknown>) {
    const user = session['user'] as SessionUser | undefined;
    return this.service.accept(id, user?.accessToken ?? null, undefined, user?.username ?? null);
  }

  @Post(':id/apply-form')
  @HttpCode(204)
  async applyForm(
    @Param('id') id: string,
    @Body() body: { slotId: string; value?: string },
    @Session() session: Record<string, unknown>,
  ) {
    const user = session['user'] as SessionUser | undefined;
    if (!body.slotId) {
      throw new Error('slotId is required');
    }
    await this.service.applySingleForm(
      id,
      user?.accessToken ?? null,
      body.slotId,
      user?.username ?? null,
      body.value,
    );
  }

  @Post(':id/edit-and-accept')
  @HttpCode(200)
  async editAndAccept(
    @Param('id') id: string,
    @Body() body: { payload: Record<string, unknown> },
    @Session() session: Record<string, unknown>,
  ) {
    const user = session['user'] as SessionUser | undefined;
    return this.service.accept(id, user?.accessToken ?? null, body.payload, user?.username ?? null);
  }

  @Post(':id/revoke')
  @HttpCode(204)
  async revoke(@Param('id') id: string) {
    await this.service.revokeSuggestion(id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(
    @Param('id') id: string,
    @Body() body: { reasonCategory?: ReasonCategory; comment?: string },
    @Session() session: Record<string, unknown>,
  ) {
    const user = session['user'] as SessionUser | undefined;
    console.log('[reject] request', {
      id,
      reasonCategory: body.reasonCategory,
      comment: body.comment,
      username: user?.username ?? null,
    });
    return this.service.reject(
      id,
      user?.username ?? null,
      body.reasonCategory ?? null,
      body.comment ?? null,
    );
  }

  @Post('generate')
  @HttpCode(200)
  async generate() {
    if (this.service.getPipelineStatus().running) {
      throw new ConflictException('Pipeline is already running.');
    }
    return this.service.runGenerationPipeline();
  }

  @Delete('processed')
  @HttpCode(200)
  async clearProcessed() {
    return this.service.clearProcessed();
  }

  @Delete()
  @HttpCode(200)
  async clear(@Query('status') status?: SuggestionStatus) {
    return this.service.clearAll(status);
  }

  @Post('deduplicate-pending')
  @HttpCode(200)
  async deduplicatePending(): Promise<{ deleted: number }> {
    return this.service.removeDuplicatePendingSuggestions();
  }
}
