export type Artist = {
  tag: string;
  weight: number;
  category: string;
  prompt: string;
};
export type Category = {
  name: string;
  tags: string[];
  min_weight: number;
  max_weight: number;
  granule: number;
  picks: number;
  min_picks: number;
  max_picks: number;
  all_artists: boolean;
  /** Registered but skipped when drawing artists. */
  disabled_tags?: string[];
};
export type Character = { prompt: string; negative: string };
export type Preset = {
  name: string;
  base_prompt: string;
  characters: Character[];
};
export type ImageItem = {
  path: string;
  image_url: string;
  history_id: string;
  artists: Artist[];
  prompt?: string;
  negative_prompt?: string;
  preset?: string;
  scene_name?: string;
  seed?: number;
  width?: number;
  height?: number;
  scale?: number;
  guidance_rescale?: number;
  generation_settings?: Partial<Settings>;
  sweep_x?: number;
  sweep_y?: number;
  favorite?: boolean;
  mock?: boolean;
  error?: string;
};
export type History = {
  id: string;
  preset?: string;
  base_preset?: string;
  character_preset?: string;
  created_at: string;
  type?: string;
  items: ImageItem[];
  sweep?: {
    source_path: string;
    source_seed: number;
    x_values: number[];
    y_values: number[];
    settings_source: string;
  };
};
export type Settings = {
  token: string;
  token_saved?: boolean;
  endpoint: string;
  user_agent: string;
  model: string;
  width: number;
  height: number;
  steps: number;
  scale: number;
  uncond_scale: number;
  guidance_rescale: number;
  sampler: string;
  noise_schedule: string;
  n_samples: number;
  seed: number;
  mock_mode: boolean;
};
export type SceneSize = { image_size: string; count: number };
export type Scene = {
  name: string;
  preset: string;
  /** One preset per scene; each row is an image size and its image count. */
  sizes: SceneSize[];
  /** Free-form labels; "feet" marks scenes used to test the feet group. */
  tags?: string[];
};
export type GuidanceSettings = {
  source_path: string;
  x_min: number;
  x_max: number;
  x_step: number;
  y_min: number;
  y_max: number;
  y_step: number;
};
export type AppState = {
  guidance_test: GuidanceSettings;
  schema_version: 2;
  categories: Category[];
  prompt_presets: Preset[];
  quality_prompt: string;
  negative_prompt: string;
  api: Settings;
  generation: {
    preset: string;
    count: number;
    image_size: string;
    fixed_artists: Artist[];
  };
  batting_scenes: Scene[];
  /** Scene tags defined once; each scene picks from them. */
  scene_tags: string[];
  history: History[];
};
export type Job = {
  id: string;
  name: string;
  status: string;
  progress: number;
  total: number;
  last_error?: string;
  failures?: number;
  campaign_id?: string;
};
/** How a campaign treats one artist group. */
export type PlanMode = "pick" | "rate" | "fixed" | "off";
export type PlanEntry = {
  group: string;
  mode: PlanMode;
  /** Rate groups: failure labels offered, and the scene tag limiting scenes ("" = all). */
  labels?: string[];
  scene_tag?: string;
};
export type StageInfo = {
  key: string;
  kind: "evolve" | "round" | "done";
  group: string | null;
  labels: string[];
  scene_tag: string;
  name: string;
};
export type Gene = { group: string; tag: string; weight: number };
export type Genome = {
  id: string;
  genes: Gene[];
  parents: string[];
  origin: string;
  born_in: number;
};
export type Trial = {
  id: string;
  genome_id: string;
  seed: number;
  scene: string;
  image_path: string;
  image_url: string;
  job_id: string;
  failures: string[];
  error: string;
  stage: string;
  batch: number;
  created_at: string;
};
export type Generation = {
  index: number;
  genome_ids: string[];
  seeds: number[];
  picks: string[];
  status: "pending" | "generating" | "awaiting_pick" | "done";
  stage: string;
  origins: string[];
  parents: string[][];
};
export type RoundResult = {
  finalists?: string[];
  recommended?: string;
  overlap?: boolean;
  next_round?: number;
};
export type Round = {
  index: number;
  genome_ids: string[];
  seeds: number[];
  scenes: string[];
  survivors: string[];
  status: "pending" | "generating" | "awaiting_labels" | "done";
  stage: string;
  eliminated: string[];
  result: RoundResult;
};
export type GenomeStats = {
  s: number;
  n: number;
  rate: number;
  low: number;
  high: number;
  reasons: Record<string, number>;
  scenes: Record<string, { s: number; n: number }>;
};
export type CampaignParams = {
  pop_size: number;
  seeds_per_gen: number;
  max_generations: number;
  stop_after_same_winner: number;
  converge_after_same_winner: number;
  second_op_prob: number;
  round_candidates: number;
  round_seeds: number[];
  retune_generations: number;
  confirm_seeds: number;
  wilson_z: number;
};
export type Campaign = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  stage: string;
  plan: PlanEntry[];
  /** Image size of the pick and retune stages ("" = the studio's size). */
  image_size: string;
  /** Prompt order of the groups (the artist menu's order). */
  group_order: string[];
  frozen: Record<string, Gene[]>;
  params: CampaignParams;
  preset: string;
  genomes: Record<string, Genome>;
  generations: Generation[];
  rounds: Round[];
  trials: Trial[];
  champions: Record<string, string>;
  info: {
    stage_name: string;
    stage: StageInfo;
    stages: StageInfo[];
    reference_stage: string;
    progress: string;
    pending: number;
    streak: number;
    converging: boolean;
    generation_limit: number;
    round_count: number;
    next_stage: string;
    suggest_finish: boolean;
    /** Scenes the next stage would use, when it is a rate stage. */
    next_scenes: string[];
    stats: Record<string, Record<string, GenomeStats>>;
    job_id: string;
  };
};
export type CampaignSummary = {
  id: string;
  name: string;
  stage: string;
  stage_name: string;
  progress: string;
  created_at: string;
  updated_at: string;
  images: number;
};
/** Artists handed to the explore tab from an image ("이 조합으로 탐색"). */
export type ExploreEntry = { artists: Artist[]; preset?: string };
export type Preview = { prompt: string; negative: string; artists: Artist[] };
