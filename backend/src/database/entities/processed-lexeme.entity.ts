import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

import type { SuggestionType } from './suggestion.entity';

export type ProcessedOutcome = 'no_gap' | 'uncountable' | 'suggestion_created';

@Entity('processed_lexemes')
@Unique(['lexemeId', 'suggestionType'])
export class ProcessedLexeme {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  lexemeId!: string;

  @Column({ type: 'varchar' })
  suggestionType!: SuggestionType;

  @Column({ type: 'varchar', nullable: true })
  lastDecision!: ProcessedOutcome | null;

  @Column({ type: 'bigint', nullable: true })
  lastRevisionId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
