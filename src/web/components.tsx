// Small building blocks shared by the screens.

import type { ReactNode } from 'react';
import { formatScore, positionOf, type RankState } from '../core/ranking';
import type { Prediction } from '../core/recommender';
import type { Bucket, GameId, GameMeta, LibraryRow } from '../core/types';
import { coverUrl, ttbLabel } from './derive';

export const BUCKET_LABEL: Record<Bucket, string> = { loved: 'Loved', liked: 'Liked', disliked: "Didn't like" };

export function Cover({ meta, big = false }: { meta: GameMeta | undefined; big?: boolean }) {
  const url = coverUrl(meta?.coverImageId ?? null, big ? 't_cover_big' : 't_cover_small');
  return url ? <img className={big ? 'cover big' : 'cover'} src={url} alt="" loading="lazy" /> : <div className={big ? 'cover big blank' : 'cover blank'} />;
}

export function gameName(games: Map<GameId, GameMeta>, id: GameId): string {
  return games.get(id)?.name ?? `IGDB ${id}`;
}

/** One tappable row: cover, name, year, and whatever the screen puts on the right. */
export function GameRow({ meta, id, right, sub }: { meta: GameMeta | undefined; id: GameId; right?: ReactNode; sub?: ReactNode }) {
  return (
    <a className="game-row" href={`#/game/${id}`}>
      <Cover meta={meta} />
      <span className="game-row-text">
        <span className="game-name">{meta?.name ?? `IGDB ${id}`}</span>
        <span className="muted small">
          {meta?.year ?? ''}
          {sub ? <> · {sub}</> : null}
        </span>
      </span>
      {right ? <span className="game-row-right">{right}</span> : null}
    </a>
  );
}

export function ScoreBadge({ score, bucket }: { score: number; bucket: Bucket }) {
  return <span className={`score ${bucket}`}>{formatScore(score)}</span>;
}

export function DroppedMarker({ row }: { row: LibraryRow | undefined }) {
  return row?.status === 'dropped' ? <span className="tag">dropped</span> : null;
}

const CONFIDENCE_TEXT = {
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
};

/** Predicted score + why (spec §7.3). */
export function PredictionCard({
  prediction, games, state,
}: { prediction: Prediction; games: Map<GameId, GameMeta>; state: RankState }) {
  if (prediction.score === null) {
    return (
      <p className="muted">
        Rank at least 5 games to see predictions.{' '}
        <span className={`confidence ${prediction.confidence}`}>{CONFIDENCE_TEXT[prediction.confidence]}</span>
      </p>
    );
  }
  return (
    <div className="card prediction" data-testid="prediction">
      <p>
        Predicted <ScoreBadge score={prediction.score} bucket={prediction.bucket!} /> · {BUCKET_LABEL[prediction.bucket!]} ·{' '}
        <span className={`confidence ${prediction.confidence}`}>{CONFIDENCE_TEXT[prediction.confidence]}</span>
      </p>
      {prediction.above || prediction.below ? (
        <p className="muted small">
          Between {prediction.above ? `${gameName(games, prediction.above.id)} ${formatScore(prediction.above.score)}` : 'the top'} and{' '}
          {prediction.below ? `${gameName(games, prediction.below.id)} ${formatScore(prediction.below.score)}` : 'the bottom'}
        </p>
      ) : null}
      {prediction.reasons.length > 0 ? (
        <>
          <h4>Why</h4>
          <ul className="reasons" data-testid="reasons">
            {prediction.reasons.map((r) => (
              <li key={r.label}>
                {r.label} <span className={r.value >= 0 ? 'plus' : 'minus'}>{r.value >= 0 ? '+' : '−'}{Math.abs(r.value).toFixed(1)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {prediction.similar.length > 0 ? (
        <>
          <h4>Most similar ranked games</h4>
          <ul className="similar">
            {prediction.similar.map((s) => (
              <li key={s.id}>
                <a href={`#/game/${s.id}`}>{gameName(games, s.id)}</a> · #{s.position} · <ScoreBadge score={s.score} bucket={positionOf(state, s.id)?.bucket ?? s.bucket} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

export function TimeToBeat({ meta }: { meta: GameMeta | undefined }) {
  const label = ttbLabel(meta?.ttb ?? null);
  return label ? <span>{label}</span> : null;
}

export function Footer() {
  return (
    <footer className="footer muted small">
      Game data: <a href="https://www.igdb.com">IGDB.com</a> · Steam data via the Steam Web API ·{' '}
      <a href="#/privacy">Privacy</a>
    </footer>
  );
}
