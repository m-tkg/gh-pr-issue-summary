// 要約パイプラインの共通型。サイドパネルの描画でも使用する。

export type Importance = 'high' | 'medium' | 'low'

export type CommentKind =
  | 'question'
  | 'proposal'
  | 'decision'
  | 'bug'
  | 'nit'
  | 'info'
  | 'other'

/** コメント 1 件を圧縮した中間メモ（map の出力）。 */
export interface CommentNote {
  /** スレッド内 1 始まり序数。reduce での参照に使う。 */
  ordinal: number
  id: string
  url: string
  author: string
  /** ISO8601 のタイムスタンプ（取得できれば）。 */
  timestampISO?: string
  gist: string
  kind: CommentKind
  importance: Importance
  stance?: string
}

/** クラスタが参照するコメント。 */
export interface ClusterComment {
  url: string
  /** スレッド内 1 始まり序数。 */
  ordinal: number
  author: string
  /** ISO8601 のタイムスタンプ（取得できれば）。 */
  timestampISO?: string
}

/** 論点の決着状況（CLI バックエンド限定の任意項目）。 */
export type ClusterStatus = 'resolved' | 'open'

/** 議論のかたまり。 */
export interface Cluster {
  title: string
  summary: string
  importance: Importance
  /** 決着済みか未決か（CLI バックエンドのみ生成、Nano では常に undefined）。 */
  status?: ClusterStatus
  /** 該当コメント一覧（序数・投稿者・日時付き）。 */
  comments: ClusterComment[]
}

/** 手順の種別（CLI バックエンド限定の任意項目）。図のノード形状に対応する。 */
export type FlowStepKind = 'action' | 'decision' | 'outcome'

/** やろうとしている作業・提案内容の 1 手順（CLI バックエンド限定の任意項目）。 */
export interface FlowStep {
  label: string
  /** 作業 / 判断・分岐 / 成果・結論。欠落時は作業(action)と同じ描画。 */
  kind?: FlowStepKind
  comments: ClusterComment[]
}

/** 最終要約結果。 */
export interface FinalSummary {
  /** どのような issue/PR か。 */
  overview: string
  /** 親 issue / 関連 PR・issue の説明（関連情報から決定的に生成）。 */
  parentAndLinks: string
  /** 全体を通した議論。 */
  overallDiscussion: string
  /** 現状の進捗。 */
  currentProgress: string
  /** 議論のかたまり（重要度降順）。 */
  clusters: Cluster[]
  /** 作業・提案内容の流れ（CLI バックエンドのみ生成、Nano では常に undefined）。 */
  flowSteps?: FlowStep[]
}
