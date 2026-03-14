import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Separator } from '@/components/ui/separator';

export default function HomePage() {
  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col gap-4 pt-8">
        <h1 className="text-4xl font-bold tracking-tight">Wikidata Gap Fixer</h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          AI-assisted suggestions for missing morphological forms and glosses in Wikidata lexemes.
          Every suggestion requires a human to accept, edit, or reject it before anything is written
          to Wikidata.
        </p>
        <div className="flex gap-3 pt-2">
          <Button asChild size="lg">
            <Link href="/suggestions">Browse Suggestions</Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <a
              href="https://www.wikidata.org/wiki/Wikidata:Wikidata_Lexeme_Forms"
              target="_blank"
              rel="noopener noreferrer"
            >
              About Lexemes
            </a>
          </Button>
        </div>
      </section>

      <Separator />

      <section className="grid gap-6 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gap Detection</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            SPARQL queries scan Wikidata for Dutch lexemes missing expected morphological forms such
            as plural nouns and verb conjugations.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI Suggestions</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Rule-based engines produce candidate forms. GPT-4.1-mini validates, corrects, and
            explains each suggestion before it enters the review queue.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Human Review</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            You accept, edit, or reject every suggestion. Only accepted changes are written to
            Wikidata using your OAuth credentials — nothing is automatic.
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
