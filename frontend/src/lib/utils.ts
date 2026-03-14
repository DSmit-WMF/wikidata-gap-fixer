import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getSuggestionTypeLabel } from './suggestion-types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function suggestionTypeLabel(type: string): string {
  return getSuggestionTypeLabel(type);
}
