import { useState } from 'react';
import { Pressable } from 'react-native';

import { Text } from '@/components/ui';

/** Cut at a word boundary (and before trailing punctuation) so "… more" never splits a word. */
function shorten(text: string, limit: number): string {
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  const words = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${words.replace(/[\s,.;:-]+$/, '')}…`;
}

/**
 * Product description with the Big Cart inline bold "more" / "less" toggle. Short texts render
 * as-is; screen readers always get the full text.
 */
export function ExpandableText({ text, limit = 130 }: { text: string; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const body = text.trim();
  if (!body) return null;

  // Don't hide just a handful of words behind a toggle.
  if (body.length <= limit + 24) return <Text color="muted">{body}</Text>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={body}
      accessibilityHint={expanded ? 'Shows less of the description' : 'Shows the full description'}
      accessibilityState={{ expanded }}
      onPress={() => setExpanded((value) => !value)}
    >
      <Text color="muted">
        {expanded ? body : shorten(body, limit)}
        <Text variant="bodyMedium">{expanded ? '  less' : '  more'}</Text>
      </Text>
    </Pressable>
  );
}
