import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SuggestionAction } from './suggestion-action.entity';

@Entity('users')
export class User {
  @PrimaryColumn({ type: 'varchar' })
  id!: string;

  @Column({ type: 'varchar', unique: true })
  username!: string;

  @Column({ type: 'text', nullable: true })
  accessToken!: string | null;

  @Column({ type: 'text', nullable: true })
  refreshToken!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToMany(() => SuggestionAction, (action) => action.user)
  actions!: SuggestionAction[];
}
