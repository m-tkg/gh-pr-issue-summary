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
  gist: string
  kind: CommentKind
  importance: Importance
  stance?: string
}

/** 議論のかたまり。 */
export interface Cluster {
  title: string
  summary: string
  importance: Importance
  /** 該当コメントへのパーマリンク一覧。 */
  commentUrls: string[]
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
}
