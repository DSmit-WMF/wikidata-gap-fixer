import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { SuggestionAction } from './suggestion-action.entity';

export type SuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'applied' | 'failed';

export type SuggestionType =
  | 'NL_NOUN_PLURAL_FORM'
  | 'NL_VERB_FORMS'
  | 'NL_ADJECTIVE_FORMS';

/** One proposed form within a verb suggestion payload */
export interface VerbFormProposal {
  slotId: string;
  label: string;
  grammaticalFeatures: string[];
  proposedForm: string | null;
  finalForm: string | null;
  confidence: number;
  needsLlm: boolean;
}

@Entity('suggestions')
export class Suggestion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  lexemeId!: string;

  @Column({ type: 'varchar', default: 'nl' })
  languageCode!: string;

  @Column({ type: 'varchar' })
  suggestionType!: SuggestionType;

  /** JSON: { lemma, pos, proposedForms, glossNl, ... } */
  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  rationale!: string | null;

  @Column({ type: 'float', nullable: true })
  ruleConfidence!: number | null;

  @Column({ type: 'float', nullable: true })
  llmConfidence!: number | null;

  @Column({ type: 'varchar', default: 'pending' })
  status!: SuggestionStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToMany(() => SuggestionAction, (action) => action.suggestion)
  actions!: SuggestionAction[];
}
