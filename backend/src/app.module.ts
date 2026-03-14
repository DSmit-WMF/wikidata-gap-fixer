import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { configuration } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { WikidataModule } from './wikidata/wikidata.module';
import { LlmModule } from './llm/llm.module';
import { SuggestionsModule } from './suggestions/suggestions.module';
import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({ load: [configuration], isGlobal: true }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    WikidataModule,
    LlmModule,
    SuggestionsModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
