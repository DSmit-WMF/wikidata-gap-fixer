import { ConfigModule, ConfigService } from '@nestjs/config';

import { Module } from '@nestjs/common';
import { ProcessedLexeme } from './entities/processed-lexeme.entity';
import { Suggestion } from './entities/suggestion.entity';
import { SuggestionAction } from './entities/suggestion-action.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('database.url'),
        entities: [User, Suggestion, SuggestionAction, ProcessedLexeme],
        synchronize: true,
        logging: false,
        extra: {
          max: 5,
        },
      }),
    }),
  ],
})
export class DatabaseModule {}
