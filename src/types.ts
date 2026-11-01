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
export type Scene = {
  name: string;
  preset: string;
  image_size: string;
  count: number;
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
};
export type Preview = { prompt: string; negative: string; artists: Artist[] };
