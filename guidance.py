"""Deterministic axis construction for guidance/rescale image sweeps."""
from decimal import Decimal, InvalidOperation

SETTING_KEYS = ('model', 'steps', 'sampler', 'noise_schedule', 'uncond_scale', 'n_samples', 'scale', 'guidance_rescale')

def axis_values(minimum, maximum, step, limit):
    try:
        low, high, gap = (Decimal(str(value)) for value in (minimum, maximum, step))
        if not all(value.is_finite() for value in (low, high, gap)) or not 0 <= low <= high <= limit or gap <= 0:
            raise ValueError()
        count = int((high - low) // gap) + 1
        if count > 200:
            raise ValueError()
        return [float(low + gap * i) for i in range(count)]
    except (InvalidOperation, ValueError, OverflowError, TypeError):
        raise ValueError('축 범위와 간격을 확인하세요. Guidance는 0~100, Rescale은 0~1이며 간격은 양수여야 합니다. 축당 최대 200개입니다.') from None

def grid_values(settings):
    x = axis_values(settings.x_min, settings.x_max, settings.x_step, 100)
    y = axis_values(settings.y_min, settings.y_max, settings.y_step, 1)
    if len(x) * len(y) > 200:
        raise ValueError('가이던스 테스트는 한 번에 최대 200장입니다. 범위를 줄이거나 간격을 늘리세요.')
    return x, y
