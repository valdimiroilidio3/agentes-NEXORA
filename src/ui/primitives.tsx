'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { AgentStatus, TaskStatus } from '@/domain/types';

export type Tone = 'neutral' | 'active' | 'waiting' | 'error' | 'offline' | 'success';

export function toneForAgent(status: AgentStatus): Tone {
  switch (status) {
    case 'WORKING':
      return 'active';
    case 'WAITING':
      return 'waiting';
    case 'ERROR':
      return 'error';
    case 'OFFLINE':
      return 'offline';
    default:
      return 'neutral';
  }
}

export function toneForTask(status: TaskStatus): Tone {
  switch (status) {
    case 'RUNNING':
      return 'active';
    case 'QUEUED':
    case 'WAITING':
      return 'waiting';
    case 'FAILED':
      return 'error';
    case 'COMPLETED':
      return 'success';
    default:
      return 'neutral';
  }
}

export function StatusDot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }) {
  return <span className={`status-dot status-dot--${tone}${pulse ? ' is-pulsing' : ''}`} aria-hidden />;
}

export function Badge({
  tone = 'neutral',
  children,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`badge badge--${tone}`} title={title}>
      {children}
    </span>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: 'default' | 'primary' | 'ghost' | 'danger';
  readonly size?: 'sm' | 'md';
}

export function Button({ variant = 'default', size = 'md', className = '', ...rest }: ButtonProps) {
  return <button className={`btn btn--${variant} btn--${size} ${className}`.trim()} {...rest} />;
}

export function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <header className="section__head">
        <h3>{title}</h3>
        {aside ? <div className="section__aside">{aside}</div> : null}
      </header>
      <div className="section__body">{children}</div>
    </section>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      {hint ? <p className="empty-state__hint">{hint}</p> : null}
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function DataSourceNote() {
  return (
    <p className="data-note">
      <Badge tone="waiting">DEMO DATA</Badge>
      All agents, tasks and results are local fixtures. Runs use the simulated demo adapter unless the live execution
      bridge is configured.
    </p>
  );
}
