'use client';

import { useState } from 'react';

import { useMediaQuery } from '@/shared/lib/react';
import { Segmented } from '@/shared/ui';

import { TeamConversation, type TeamConversationProps } from './TeamConversation';
import { TeamDiagram } from './TeamDiagram';

type View = 'lista' | 'diagrama';

/** Below this width the lanes do not fit, so only the list exists. */
export const DIAGRAM_MIN_WIDTH = '(min-width: 768px)';

/** The team's conversation as a list or, on wide screens, as a diagram with one lane per member. */
export function TeamWork(props: Omit<TeamConversationProps, 'tools' | 'children'>) {
  const wide = useMediaQuery(DIAGRAM_MIN_WIDTH);
  const [view, setView] = useState<View>('lista');
  const diagram = wide && view === 'diagrama';

  return (
    <TeamConversation
      {...props}
      tools={
        wide ? (
          <Segmented<View>
            label="Forma de ver"
            value={view}
            options={[
              { value: 'lista', label: 'Lista' },
              { value: 'diagrama', label: 'Diagrama' },
            ]}
            onChange={setView}
          />
        ) : undefined
      }
    >
      {diagram ? (
        <TeamDiagram messages={props.messages} start={props.start} onOpen={props.onOpen} />
      ) : undefined}
    </TeamConversation>
  );
}
