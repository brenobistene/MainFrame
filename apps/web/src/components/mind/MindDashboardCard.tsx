/**
 * Card vitals do Mind no Dashboard.
 *
 * Foco: o que pede ATENÇÃO. Não é card de vaidade — só aparece se há algo
 * a fazer (hipóteses pendentes ou desafios). Sem isso, esconde.
 *
 * Filosofia: dashboard surfaces que viraram nag são ruído; Mind se faz, não
 * se monitora. Só puxa pro radar quando há hipótese pendente há tempo demais
 * ou padrão recorrente que precisa confronto.
 */
import { AlertTriangle, ChevronRight, Eye } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useMindChallenges, useMindHipoteses } from '../../lib/health-queries'
import { BODY, MONO } from '../health/tokens'

const MIND_COR = '#9b88c4'

export default function MindDashboardCard() {
  const { data: challenges = [] } = useMindChallenges()
  const { data: pending = [] } = useMindHipoteses('pending')

  // Esconde card se não tem nada a confrontar. Pending sem challenge ativo
  // (frequência baixa) é estado normal — não precisa nag no Dashboard.
  if (challenges.length === 0 && pending.length === 0) return null

  return (
    <div
      className="hq-glass-elevated hq-grain hq-card-hoverable hq-chamfer-cross"
      style={{
        position: 'relative',
        padding: 'var(--space-4) var(--space-5)',
      }}
    >
      <div
        aria-hidden="true"
        className="hq-hairline-ice"
        style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
      />

      <Link
        to="/mind"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          textDecoration: 'none',
          color: 'inherit',
          marginBottom: 'var(--space-3)',
        }}
      >
        <Eye size={14} strokeWidth={1.8} color={MIND_COR} />
        <span
          className="hq-tech-label"
          style={{
            fontSize: 11,
            color: MIND_COR,
            letterSpacing: '0.28em',
          }}
        >
          MIND
        </span>
        <span
          className="hq-tech-id"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {challenges.length > 0 ? 'CONFRONTAR' : 'PENDENTE'}
        </span>
        <ChevronRight
          size={12}
          color="var(--color-text-muted)"
          style={{ marginLeft: 'auto' }}
        />
      </Link>

      {challenges.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {challenges.slice(0, 3).map((c) => (
            <div
              key={c.hipotese.id}
              className="hq-chamfer-bl"
              style={{
                padding: '8px 10px',
                borderLeft: '2px solid var(--color-warning)',
                background: 'var(--color-bg-primary)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 4,
                }}
              >
                <AlertTriangle size={10} color="var(--color-warning)" />
                <span
                  className="hq-tech-id"
                  style={{
                    color: 'var(--color-warning)',
                    letterSpacing: '0.18em',
                    fontSize: 9,
                  }}
                >
                  HIPÓTESE A CONFRONTAR
                </span>
                <span
                  className="hq-tech-id"
                  style={{
                    color: 'var(--color-text-muted)',
                    marginLeft: 'auto',
                    fontSize: 9,
                  }}
                >
                  {c.hipotese.aparicoes_recentes}x
                </span>
              </div>
              <div
                style={{
                  fontFamily: BODY,
                  fontSize: 13,
                  color: 'var(--color-text-primary)',
                  fontStyle: 'italic',
                  lineHeight: 1.4,
                }}
              >
                "{c.hipotese.texto}"
              </div>
            </div>
          ))}
          {challenges.length > 3 && (
            <div
              className="hq-tech-id"
              style={{
                color: 'var(--color-text-muted)',
                fontStyle: 'italic',
                fontSize: 9,
              }}
            >
              + {challenges.length - 3} outros desafios
            </div>
          )}
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 'var(--space-5)',
          }}
        >
          <Vital
            label="HIPÓTESES PENDENTES"
            value={String(pending.length)}
            accent="var(--color-warning)"
          />
          <span
            className="hq-tech-id"
            style={{
              color: 'var(--color-text-muted)',
              fontStyle: 'italic',
            }}
          >
            sem padrão recorrente — confronto natural
          </span>
        </div>
      )}
    </div>
  )
}

function Vital({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span className="hq-tech-id" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 18,
          fontWeight: 500,
          color: accent,
          letterSpacing: 0,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  )
}

