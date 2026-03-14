import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { Suggestion } from './suggestion.entity';
import { User } from './user.entity';

export type ActionType = 'accepted' | 'rejected' | 'edited_accepted' | 'applied_form';

export type ReasonCategory = 'wrong_form' | 'wrong_meaning' | 'ambiguous' | 'other';

@Entity('suggestion_actions')
export class SuggestionAction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Suggestion, (s) => s.actions, { onDelete: 'CASCADE' })
  suggestion!: Suggestion;

  @Column({ type: 'varchar' })
  suggestionId!: string;

  @ManyToOne(() => User, (u) => u.actions, { nullable: true })
  user!: User | null;

  @Column({ type: 'varchar', nullable: true })
  userId!: string | null;

  @Column({ type: 'varchar' })
  action!: ActionType;

  @Column({ type: 'varchar', nullable: true })
  reasonCategory!: ReasonCategory | null;

  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
