import { LlmModule } from '../llm/llm.module';
import { Module } from '@nestjs/common';
import { ProcessedLexeme } from '../database/entities/processed-lexeme.entity';
import { Suggestion } from '../database/entities/suggestion.entity';
import { SuggestionAction } from '../database/entities/suggestion-action.entity';
import { SuggestionsController } from './suggestions.controller';
import { SuggestionsService } from './suggestions.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../database/entities/user.entity';
import { WikidataModule } from '../wikidata/wikidata.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Suggestion, SuggestionAction, ProcessedLexeme, User]),
    WikidataModule,
    LlmModule,
  ],
  controllers: [SuggestionsController],
  providers: [SuggestionsService],
  exports: [SuggestionsService],
})
export class SuggestionsModule {}
