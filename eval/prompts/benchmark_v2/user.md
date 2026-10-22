The video is attached. Here is the full rubric (JSON) it must be judged against:

```json
{rubric_json}
```

The task the person should perform:
- Description: {task_description}
- Steps, in order: {task_steps}
- Final state when done: {task_final_state}

Measure every check below, even those disabled in the rubric (they are ignored if disabled):

- task_completed: `completed` = true if the whole task is finished in the video (all steps
  done and the final state reached), false if it is clearly not finished (stops before the
  end, a step is missing), null if you cannot tell.
- hands_visible: `ratio_both_manipulation` = share of the manipulation time during which BOTH
  hands are fully visible; `ratio_any_manipulation` = at least one hand fully visible;
  `ratio_both_whole` / `ratio_any_whole` = the same over the whole video;
  `manipulation_detected` = whether any manipulation happens at all.
- framing: `off_target_ratio` = share of time the camera points away from the work;
  `unstable_ratio` = share of time the image shakes so much the work is hard to follow.
- technical: `blur_ratio` = share of time the image is too blurry to see the hands and objects;
  `bad_exposure_ratio` = share of time it is far too dark or too bright.
- privacy: every moment a person's face, a readable document, or a screen showing content is
  visible, as lists of {"t_s": seconds}. Empty lists if none.
