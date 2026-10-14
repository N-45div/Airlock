import { useLayoutEffect, useRef } from 'react';
import { PRODUCT } from '../brand.ts';
import { Icon } from '../ui/Icon.tsx';
import { Card, Chip, cx, SectionHeading } from '../ui/primitives.tsx';
import { clockTime, plural } from './format.ts';
import {
  decisionLook,
  displaySummary,
  fenceCounts,
  heldByLabel,
  toolKind,
  toolName,
  type FenceRow,
} from './labels.ts';
import type { Thought } from './useScan.ts';

function rowReason(row: FenceRow): string {
  const { event, held } = row;
  if (!held) return event.reason ?? '';
  const heldText = held.reason ? `${heldByLabel(held.by)}: ${held.reason}` : heldByLabel(held.by);
  return [heldText, event.reason].filter(Boolean).join(' ');
}

export function FenceRowView({ row }: { row: FenceRow }) {
  const look = decisionLook(row);
  const { event } = row;
  const summary = displaySummary(event.summary);
  const reason = rowReason(row);
  return (
    <li className={cx('fence-row', `fence-row--${event.decision}`)}>
      <details>
        <summary className="fence-row__head" title={reason || undefined}>
          <span className="fence-row__tool">{toolName(event.tool)}</span>
          <code className="fence-row__summary">{summary || 'no input'}</code>
          <span className="fence-row__decision">
            <Chip tone={look.tone} icon={look.icon}>
              {look.label}
            </Chip>
          </span>
          <Icon name="chevron" size={16} className="fence-row__chevron" />
        </summary>
        <div className="fence-row__body">
          {summary ? <code className="fence-row__full">{summary}</code> : null}
          {reason ? <p className="fence-row__reason">{reason}</p> : null}
          <p className="fence-row__time">{clockTime(event.at)}</p>
        </div>
      </details>
    </li>
  );
}

/** The log itself; it follows new rows while the reader is at the bottom. */
export function FenceLog({ rows, live = false, label }: { rows: FenceRow[]; live?: boolean; label: string }) {
  const log = useRef<HTMLOListElement>(null);
  const atBottom = useRef(true);

  useLayoutEffect(() => {
    const el = log.current;
    if (el && live && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [rows.length, live]);

  return (
    <ol
      ref={log}
      className={cx('fence__log', live && 'is-live')}
      aria-label={label}
      aria-live={live ? 'polite' : undefined}
      aria-relevant={live ? 'additions text' : undefined}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
    >
      {rows.map((row) => (
        <FenceRowView key={row.held?.id ?? row.event.id} row={row} />
      ))}
    </ol>
  );
}

function AgentNotes({ thoughts }: { thoughts: Thought[] }) {
  return (
    <details className="notes">
      <summary className="notes__summary">
        <Icon name="message" size={16} />
        <span>Agent notes</span>
        <span className="notes__count">{thoughts.length}</span>
        <Icon name="chevron" size={16} className="notes__chevron" />
      </summary>
      <ol className="notes__list">
        {thoughts.map((t) => (
          <li key={t.n}>
            <time className="notes__time">{clockTime(t.at)}</time>
            <p>{t.text}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function FencePanel({ rows, live, thoughts }: { rows: FenceRow[]; live: boolean; thoughts: Thought[] }) {
  const counts = fenceCounts(rows);
  const blocked = rows.filter((r) => r.event.decision === 'blocked' && toolKind(r.event.tool) === 'command');
  const armorIq = rows.length === 0 || rows.some((r) => r.event.by === 'armoriq' || r.held?.by === 'armoriq');

  return (
    <section aria-labelledby="fence-title">
      <SectionHeading
        id="fence-title"
        eyebrow="The fence"
        title="Every tool call, and who decided it"
        aside={counts || (live ? 'Waiting for the first call' : 'No tool calls')}
      />
      <Card pad="none" className="fence">
        <p className="fence__intro">
          {armorIq
            ? `ArmorIQ’s policy decides each call the agent makes: reads are allowed, commands are blocked, and fetching a page waits for you. ${PRODUCT}’s backstop sits behind it and refuses anything that is not a read inside the repository.`
            : `${PRODUCT}’s backstop decided each call the agent made: reads inside the repository are allowed, fetching a page waits for you, and everything else is refused.`}
        </p>
        {blocked.length > 0 ? (
          <div className="fence-test">
            <span className="fence-test__icon">
              <Icon name="blocked" size={20} />
            </span>
            <div className="fence-test__body">
              <p className="fence-test__title">Fence test</p>
              <p className="fence-test__text">
                The agent tried to run {blocked.length === 1 ? 'a command' : plural(blocked.length, 'command')}. The fence
                refused {blocked.length === 1 ? 'it' : 'them'}, so nothing from the repository ran.
              </p>
              <ul className="fence-test__list">
                {blocked.map((row) => (
                  <li key={row.event.id}>
                    <code>{displaySummary(row.event.summary)}</code>
                    <Chip tone="danger" icon="blocked">
                      {decisionLook(row).label}
                    </Chip>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
        {rows.length > 0 ? (
          <FenceLog rows={rows} live={live} label="Tool calls, oldest first" />
        ) : (
          <p className="fence__empty">
            {live ? 'The first tool call shows up here as soon as the agent makes it.' : 'The agent made no tool calls.'}
          </p>
        )}
      </Card>
      {thoughts.length > 0 && (!live || thoughts.length > 3) ? <AgentNotes thoughts={thoughts} /> : null}
    </section>
  );
}
