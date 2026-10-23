# Viewpoint check (#79)

run 39927351695 on `agent/viewpoint` (commit `317b858`) · worker `viewpoint@0.3.0` applied to the stored features. Labels come from the sources (Egocentric-10K and HoloAssist are head-mounted; the Pexels clips are the founder's picks; Pixabay clips are labelled by eye from their contact sheets, founder veto on #79), never from Ormes. Constants fitted on `dev` only; `held_out` was not looked at while fitting. For now both a wrong viewpoint and `uncertain` send the video to review (the check cannot reject yet).

**Before:** Ormes had no viewpoint check: every third-person video went through as if first-person (third-person caught: 0%).

| split | first-person clips | called third-person (costly error) | uncertain (review) | third-person clips | called first-person (missed) | uncertain (review) | caught |
|---|---|---|---|---|---|---|---|
| dev | 65 | 0.00 [0.00-0.06] (0/65) | 0.20 [0.12-0.31] (13/65) | 33 | 0.03 [0.01-0.15] (1/33) | 0.52 [0.35-0.67] (17/33) | 0.45 [0.30-0.62] (15/33) |
| held_out | 27 | 0.00 [0.00-0.12] (0/27) | 0.19 [0.08-0.37] (5/27) | 30 | 0.03 [0.01-0.17] (1/30) | 0.60 [0.42-0.75] (18/30) | 0.37 [0.22-0.54] (11/30) |
| dev + held_out | 92 | 0.00 [0.00-0.04] (0/92) | 0.20 [0.13-0.29] (18/92) | 63 | 0.03 [0.01-0.11] (2/63) | 0.56 [0.43-0.67] (35/63) | 0.41 [0.30-0.54] (26/63) |

By source (all splits):

| source | label | clips | first-person | uncertain | third-person |
|---|---|---|---|---|---|
| egocentric10k | first_person | 60 | 49 | 11 | 0 |
| holoassist | first_person | 27 | 23 | 4 | 0 |
| pexels | first_person | 4 | 2 | 2 | 0 |
| pexels | third_person | 7 | 0 | 3 | 4 |
| pixabay | first_person | 1 | 0 | 1 | 0 |
| pixabay | third_person | 56 | 2 | 32 | 22 |

Every labelled clip:

| clip | split | label | verdict | first_person_ratio | hand frames | pointing up (median) | hand scale | face share | head share | still share |
|---|---|---|---|---|---|---|---|---|---|---|
| ego10k_factory001_worker001_00000 | dev | first_person | first_person | 0.938 | 16 | 0.983 | 0.16 | 0.0 | None | 0.013 |
| ego10k_factory001_worker001_00001 | dev | first_person | first_person | 0.944 | 18 | 0.985 | 0.151 | 0.0 | None | 0.0 |
| ego10k_factory002_worker001_00000 | dev | first_person | first_person | 0.974 | 39 | 0.961 | 0.171 | 0.0 | None | 0.038 |
| ego10k_factory003_worker001_00000 | dev | first_person | first_person | 0.943 | 35 | 0.919 | 0.173 | 0.0 | None | 0.038 |
| ego10k_factory004_worker001_00000 | dev | first_person | first_person | 0.964 | 56 | 0.972 | 0.239 | 0.0 | None | 0.025 |
| ego10k_factory005_worker001_00000 | dev | first_person | uncertain | 0.333 | 3 | -0.093 | 0.057 | 0.0 | None | 0.0 |
| ego10k_factory006_worker001_00000 | dev | first_person | uncertain | 0.75 | 4 | 0.636 | 0.139 | 0.0 | None | 0.026 |
| ego10k_factory007_worker001_00000 | dev | first_person | first_person | 0.981 | 54 | 0.975 | 0.157 | 0.0 | None | 0.014 |
| ego10k_factory008_worker001_00000 | dev | first_person | first_person | 0.958 | 48 | 0.958 | 0.144 | 0.0 | None | 0.138 |
| ego10k_factory009_worker001_00000 | held_out | first_person | uncertain | 0.917 | 12 | 0.804 | 0.129 | 0.0 | None | 0.025 |
| ego10k_factory010_worker001_00001 | dev | first_person | uncertain | 1.0 | 2 | 0.993 | 0.11 | 0.05 | None | 0.0 |
| ego10k_factory010_worker001_00003 | dev | first_person | first_person | 1.0 | 48 | 0.862 | 0.18 | 0.0 | None | 0.113 |
| ego10k_factory011_worker001_00001 | dev | first_person | first_person | 1.0 | 28 | 0.993 | 0.173 | 0.0 | None | 0.013 |
| ego10k_factory011_worker001_00002 | dev | first_person | first_person | 1.0 | 40 | 0.983 | 0.152 | 0.0 | None | 0.025 |
| ego10k_factory012_worker001_00003 | held_out | first_person | first_person | 0.987 | 77 | 0.974 | 0.209 | 0.0 | None | 0.138 |
| ego10k_factory012_worker001_00009 | held_out | first_person | first_person | 0.947 | 75 | 0.911 | 0.213 | 0.0 | None | 0.212 |
| ego10k_factory013_worker001_00006 | held_out | first_person | first_person | 0.98 | 51 | 0.845 | 0.251 | 0.0 | None | 0.064 |
| ego10k_factory013_worker001_00008 | held_out | first_person | first_person | 0.976 | 42 | 0.862 | 0.265 | 0.0 | None | 0.026 |
| ego10k_factory014_worker001_00000 | held_out | first_person | first_person | 0.932 | 44 | 0.896 | 0.166 | 0.0 | None | 0.256 |
| ego10k_factory014_worker001_00007 | held_out | first_person | first_person | 1.0 | 71 | 0.947 | 0.192 | 0.0 | None | 0.0 |
| ego10k_factory015_worker001_00000 | dev | first_person | first_person | 0.66 | 50 | 0.583 | 0.213 | 0.0 | None | 0.215 |
| ego10k_factory015_worker001_00006 | dev | first_person | first_person | 0.926 | 54 | 0.966 | 0.252 | 0.0 | None | 0.177 |
| ego10k_factory016_worker001_00000 | held_out | first_person | first_person | 1.0 | 18 | 0.89 | 0.157 | 0.0 | None | 0.0 |
| ego10k_factory017_worker001_00001 | held_out | first_person | first_person | 0.919 | 62 | 0.94 | 0.239 | 0.0 | None | 0.0 |
| ego10k_factory017_worker001_00002 | held_out | first_person | first_person | 0.86 | 50 | 0.867 | 0.208 | 0.0 | None | 0.1 |
| ego10k_factory018_worker001_00001 | dev | first_person | first_person | 1.0 | 53 | 0.962 | 0.217 | 0.0 | None | 0.113 |
| ego10k_factory018_worker001_00002 | dev | first_person | first_person | 1.0 | 45 | 0.926 | 0.209 | 0.0 | None | 0.013 |
| ego10k_factory019_worker001_00005 | dev | first_person | uncertain | 0.0 | 17 | -0.889 | 0.132 | 0.0 | None | 0.775 |
| ego10k_factory019_worker001_00006 | dev | first_person | uncertain | 0.0 | 32 | -0.921 | 0.106 | 0.0 | None | 0.887 |
| ego10k_factory020_worker001_00000 | dev | first_person | first_person | 1.0 | 44 | 0.884 | 0.18 | 0.0 | None | 0.039 |
| ego10k_factory020_worker001_00004 | dev | first_person | first_person | 1.0 | 71 | 0.947 | 0.181 | 0.0 | None | 0.062 |
| ego10k_factory021_worker001_00005 | dev | first_person | first_person | 0.966 | 58 | 0.918 | 0.257 | 0.0 | None | 0.113 |
| ego10k_factory021_worker001_00009 | dev | first_person | first_person | 0.951 | 41 | 0.952 | 0.148 | 0.0 | None | 0.038 |
| ego10k_factory022_worker001_00001 | dev | first_person | first_person | 0.981 | 54 | 0.939 | 0.202 | 0.0 | None | 0.0 |
| ego10k_factory022_worker001_00004 | dev | first_person | first_person | 0.986 | 69 | 0.897 | 0.181 | 0.0 | None | 0.013 |
| ego10k_factory023_worker001_00001 | dev | first_person | first_person | 1.0 | 77 | 0.975 | 0.215 | 0.0 | None | 0.138 |
| ego10k_factory023_worker001_00002 | dev | first_person | first_person | 1.0 | 75 | 0.963 | 0.215 | 0.0 | None | 0.138 |
| ego10k_factory024_worker001_00002 | dev | first_person | uncertain | 0.5 | 4 | 0.641 | 0.187 | 0.0 | None | 0.0 |
| ego10k_factory024_worker001_00006 | dev | first_person | first_person | 0.984 | 62 | 0.885 | 0.235 | 0.0 | None | 0.025 |
| ego10k_factory025_worker001_00001 | held_out | first_person | first_person | 1.0 | 65 | 0.867 | 0.251 | 0.0 | None | 0.138 |
| ego10k_factory025_worker001_00007 | held_out | first_person | first_person | 1.0 | 62 | 0.951 | 0.26 | 0.0 | None | 0.25 |
| ego10k_factory026_worker001_00000 | dev | first_person | first_person | 0.917 | 24 | 0.891 | 0.13 | 0.0 | None | 0.013 |
| ego10k_factory026_worker001_00003 | dev | first_person | first_person | 0.941 | 17 | 0.882 | 0.129 | 0.0 | None | 0.013 |
| ego10k_factory027_worker001_00000 | dev | first_person | first_person | 0.95 | 20 | 0.898 | 0.168 | 0.0 | None | 0.0 |
| ego10k_factory027_worker001_00006 | dev | first_person | first_person | 1.0 | 59 | 0.758 | 0.208 | 0.0 | None | 0.295 |
| ego10k_factory028_worker001_00003 | dev | first_person | first_person | 1.0 | 60 | 0.962 | 0.125 | 0.0 | None | 0.062 |
| ego10k_factory028_worker001_00008 | dev | first_person | first_person | 1.0 | 41 | 0.96 | 0.142 | 0.0 | None | 0.013 |
| ego10k_factory029_worker001_00000 | held_out | first_person | first_person | 0.952 | 21 | 0.962 | 0.19 | 0.0 | None | 0.0 |
| ego10k_factory029_worker001_00004 | held_out | first_person | first_person | 0.962 | 52 | 0.976 | 0.176 | 0.0 | None | 0.013 |
| ego10k_factory030_worker001_00001 | dev | first_person | uncertain | 0.6 | 5 | 0.852 | 0.07 | 0.0 | None | 0.025 |
| ego10k_factory030_worker001_00004 | dev | first_person | uncertain | 0.714 | 14 | 0.865 | 0.074 | 0.0 | None | 0.125 |
| ego10k_factory031_worker001_00000 | dev | first_person | first_person | 0.964 | 56 | 0.677 | 0.228 | 0.0 | None | 0.0 |
| ego10k_factory031_worker001_00001 | dev | first_person | first_person | 0.969 | 65 | 0.674 | 0.217 | 0.0 | None | 0.0 |
| ego10k_factory032_worker001_00002 | dev | first_person | first_person | 0.957 | 23 | 0.86 | 0.074 | 0.0 | None | 0.41 |
| ego10k_factory032_worker001_00003 | dev | first_person | uncertain | 0.6 | 5 | 0.696 | 0.064 | 0.05 | None | 0.241 |
| ego10k_factory033_worker001_00000 | held_out | first_person | first_person | 0.985 | 65 | 0.807 | 0.193 | 0.0 | None | 0.188 |
| ego10k_factory033_worker001_00002 | held_out | first_person | first_person | 1.0 | 78 | 0.809 | 0.209 | 0.0 | None | 0.212 |
| ego10k_factory034_worker001_00000 | dev | first_person | uncertain | 0.625 | 8 | 0.46 | 0.102 | 0.25 | None | 0.354 |
| ego10k_factory034_worker001_00002 | dev | first_person | first_person | 0.895 | 19 | 0.922 | 0.126 | 0.0 | None | 0.025 |
| ego10k_factory035_worker001_00006 | dev | first_person | first_person | 0.985 | 66 | 0.931 | 0.166 | 0.0 | None | 0.087 |
| holo_R077-21July-Nespresso | dev | first_person | first_person | 1.0 | 49 | 0.844 | 0.277 | 0.0 | None | 0.025 |
| holo_R089-27July-Coffee | dev | first_person | first_person | 0.955 | 22 | 0.887 | 0.381 | 0.0 | None | 0.025 |
| holo_R100-1Aug-Coffee | held_out | first_person | first_person | 0.846 | 39 | 0.966 | 0.241 | 0.0 | None | 0.087 |
| holo_R190-24Oct-ATV | held_out | first_person | uncertain | 1.0 | 8 | 0.78 | 0.256 | 0.0 | None | 0.051 |
| holo_R196-25Oct-RAM | dev | first_person | uncertain | 1.0 | 6 | 0.963 | 0.259 | 0.0 | None | 0.013 |
| holo_R201-7Nov-Belt | held_out | first_person | uncertain | 0.909 | 11 | 0.946 | 0.225 | 0.0 | None | 0.013 |
| holo_z023-june-21-22-gladom_disassemble | dev | first_person | first_person | 0.97 | 66 | 0.901 | 0.248 | 0.0 | None | 0.063 |
| holo_z034-june-23-22-espresso | dev | first_person | first_person | 1.0 | 56 | 0.972 | 0.255 | 0.0 | None | 0.087 |
| holo_z035-june-23-22-gopro | held_out | first_person | first_person | 1.0 | 50 | 0.819 | 0.357 | 0.0 | None | 0.025 |
| holo_z035-june-23-22-marius_assemble | dev | first_person | first_person | 0.974 | 77 | 0.868 | 0.257 | 0.0 | None | 0.125 |
| holo_z036-june-23-22-knarrevik_assemble | dev | first_person | first_person | 0.962 | 52 | 0.973 | 0.282 | 0.0 | None | 0.037 |
| holo_z075-july-01-22-marius_disassemble | dev | first_person | first_person | 1.0 | 69 | 0.934 | 0.224 | 0.0 | None | 0.101 |
| holo_z090-july-08-22-espresso | held_out | first_person | first_person | 1.0 | 52 | 0.981 | 0.242 | 0.0 | None | 0.0 |
| holo_z092-july-11-22-knarrevik_disassemble | dev | first_person | first_person | 0.933 | 60 | 0.943 | 0.418 | 0.0 | None | 0.013 |
| holo_z093-july-11-22-knarrevik_assemble | held_out | first_person | first_person | 0.986 | 70 | 0.933 | 0.288 | 0.0 | None | 0.101 |
| holo_z096-july-12-22-knarrevik_disassemble | held_out | first_person | first_person | 1.0 | 60 | 0.926 | 0.228 | 0.0 | None | 0.037 |
| holo_z103-july-14-22-dslr | dev | first_person | first_person | 1.0 | 55 | 0.815 | 0.284 | 0.0 | None | 0.025 |
| holo_z125-aug-10-22-printer_big | dev | first_person | first_person | 0.946 | 37 | 0.935 | 0.203 | 0.0 | None | 0.0 |
| holo_z127-aug-10-22-switch | dev | first_person | first_person | 1.0 | 62 | 0.97 | 0.276 | 0.0 | None | 0.025 |
| holo_z155-aug-26-22-dslr | dev | first_person | first_person | 0.901 | 71 | 0.947 | 0.238 | 0.0 | None | 0.076 |
| holo_z155-aug-26-22-rashult_disassemble | dev | first_person | first_person | 0.939 | 49 | 0.903 | 0.196 | 0.0 | None | 0.0 |
| holo_z170-sep-03-22-gladom_disassemble | dev | first_person | first_person | 1.0 | 58 | 0.87 | 0.298 | 0.0 | None | 0.037 |
| holo_z179-sep-06-22-gopro | dev | first_person | first_person | 1.0 | 80 | 0.973 | 0.284 | 0.0 | None | 0.05 |
| holo_z197-sep-18-22-gladom_assemble | held_out | first_person | first_person | 1.0 | 54 | 0.899 | 0.301 | 0.0 | None | 0.037 |
| holo_z201-sep-22-22-rashult_assemble | dev | first_person | first_person | 0.636 | 22 | 0.568 | 0.328 | 0.0 | None | 0.026 |
| holo_z202-sep-23-22-gladom_assemble | dev | first_person | uncertain | 0.9 | 10 | 0.82 | 0.388 | 0.0 | None | 0.0 |
| holo_z204-sep-25-22-printer_small | dev | first_person | first_person | 0.833 | 18 | 0.938 | 0.192 | 0.0 | None | 0.141 |
| pexels_37443407 | dev | first_person | first_person | 1.0 | 48 | 0.744 | 0.348 | 0.0 | None | 0.562 |
| pexels_7204592 | held_out | first_person | first_person | 1.0 | 27 | 0.901 | 0.311 | 0.0 | None | 0.118 |
| pexels_7418650 | dev | first_person | uncertain | 0.402 | 82 | 0.416 | 0.297 | 0.0 | None | 0.273 |
| pexels_7658012 | held_out | first_person | uncertain | 1.0 | 2 | 0.891 | 0.091 | 0.0 | None | 0.712 |
| pixabay_10822 | held_out | first_person | uncertain | None | 0 | None | None | 0.0 | None | 0.646 |
| pexels_11102752 | held_out | third_person | uncertain | 0.0 | 10 | -0.587 | 0.145 | 0.0 | None | 0.091 |
| pexels_4440711 | dev | third_person | uncertain | 0.7 | 10 | 0.87 | 0.199 | 0.0 | None | 0.444 |
| pexels_4520150 | dev | third_person | uncertain | 0.0 | 24 | -0.886 | 0.153 | 0.0 | None | 0.438 |
| pexels_5592524 | held_out | third_person | third_person | 0.0 | 44 | -0.282 | 0.233 | 0.059 | None | 0.03 |
| pexels_7308220 | held_out | third_person | third_person | 0.0 | 33 | -0.304 | 0.142 | 0.0 | None | 0.364 |
| pexels_7641501 | held_out | third_person | third_person | 0.172 | 29 | 0.026 | 0.11 | 0.0 | None | 0.069 |
| pexels_9141844 | dev | third_person | third_person | 0.283 | 46 | 0.045 | 0.154 | 0.0 | None | 0.071 |
| pixabay_1006 | dev | third_person | uncertain | 0.833 | 12 | 0.573 | 0.096 | 0.0 | None | 0.718 |
| pixabay_1108 | dev | third_person | third_person | 0.0 | 23 | -0.32 | 0.107 | 0.0 | None | 0.848 |
| pixabay_1111 | dev | third_person | uncertain | 0.0 | 4 | -0.258 | 0.197 | 0.0 | None | 0.333 |
| pixabay_111832 | dev | third_person | uncertain | 0.0 | 14 | -0.029 | 0.553 | 0.0 | None | 0.5 |
| pixabay_11290 | held_out | third_person | uncertain | 0.0 | 3 | -0.694 | 0.197 | 0.0 | None | 0.933 |
| pixabay_11291 | held_out | third_person | third_person | 0.0 | 76 | -0.06 | 0.194 | 0.0 | None | 0.659 |
| pixabay_11305 | held_out | third_person | uncertain | 0.0 | 8 | -0.206 | 0.154 | 0.0 | None | 0.1 |
| pixabay_115790 | held_out | third_person | uncertain | 0.5 | 20 | 0.398 | 0.169 | 0.1 | None | 1.0 |
| pixabay_115792 | held_out | third_person | first_person **x** | 0.893 | 28 | 0.852 | 0.104 | 0.143 | None | 0.889 |
| pixabay_115793 | held_out | third_person | third_person | 0.12 | 25 | -0.468 | 0.177 | 0.0 | None | 0.65 |
| pixabay_11596 | dev | third_person | uncertain | 0.409 | 132 | 0.339 | 0.437 | 0.0 | None | 0.125 |
| pixabay_11597 | dev | third_person | third_person | 0.333 | 96 | 0.231 | 0.384 | 0.0 | None | 0.191 |
| pixabay_11606 | dev | third_person | third_person | 0.356 | 59 | 0.271 | 0.444 | 0.0 | None | 0.276 |
| pixabay_11638 | dev | third_person | uncertain | 0.452 | 126 | 0.36 | 0.461 | 0.0 | None | 0.181 |
| pixabay_143161 | held_out | third_person | uncertain | 0.0 | 7 | -0.528 | 0.083 | 0.0 | None | 0.896 |
| pixabay_148542 | held_out | third_person | third_person | 0.059 | 34 | 0.054 | 0.07 | 0.759 | None | 0.632 |
| pixabay_150346 | held_out | third_person | uncertain | None | 0 | None | None | 0.0 | None | 0.186 |
| pixabay_150362 | held_out | third_person | uncertain | 0.0 | 28 | -0.746 | 0.147 | 0.0 | None | 0.828 |
| pixabay_150365 | held_out | third_person | uncertain | None | 0 | None | None | 0.0 | None | 0.97 |
| pixabay_150367 | held_out | third_person | uncertain | None | 0 | None | None | 0.0 | None | 0.212 |
| pixabay_150368 | held_out | third_person | uncertain | 0.0 | 1 | 0.234 | 0.013 | 0.0 | None | 0.0 |
| pixabay_166519 | dev | third_person | uncertain | 0.4 | 5 | -0.671 | 0.133 | 0.0 | None | 0.15 |
| pixabay_172686 | dev | third_person | uncertain | 0.857 | 14 | 0.656 | 0.105 | 1.0 | None | 0.176 |
| pixabay_175152 | dev | third_person | third_person | 0.0 | 17 | 0.112 | 0.162 | 0.0 | None | 0.525 |
| pixabay_177164 | held_out | third_person | third_person | 0.0 | 39 | -0.523 | 0.076 | 1.0 | None | 0.895 |
| pixabay_177412 | held_out | third_person | uncertain | None | 0 | None | None | 0.0 | None | 0.12 |
| pixabay_177415 | held_out | third_person | uncertain | None | 0 | None | None | 0.0 | None | 0.069 |
| pixabay_192743 | dev | third_person | uncertain | None | 0 | None | None | 0.0 | None | 1.0 |
| pixabay_19600 | held_out | third_person | uncertain | 0.0 | 10 | -0.526 | 0.192 | 0.0 | None | 0.6 |
| pixabay_200157 | held_out | third_person | uncertain | 0.0 | 13 | -0.991 | 0.333 | 0.0 | None | 0.657 |
| pixabay_2339 | dev | third_person | third_person | 0.226 | 31 | -0.349 | 0.145 | 0.0 | None | 0.683 |
| pixabay_26366 | dev | third_person | uncertain | 0.0 | 31 | -0.954 | 0.193 | 0.0 | None | 0.053 |
| pixabay_263697 | held_out | third_person | third_person | 0.308 | 65 | -0.312 | 0.044 | 0.14 | None | 0.786 |
| pixabay_263703 | held_out | third_person | uncertain | 0.316 | 38 | -0.83 | 0.046 | 0.037 | None | 0.157 |
| pixabay_322794 | dev | third_person | uncertain | 0.549 | 113 | 0.11 | 0.084 | 0.772 | None | 0.509 |
| pixabay_33742 | dev | third_person | third_person | 0.048 | 63 | -0.539 | 0.368 | 0.0 | None | 0.884 |
| pixabay_34091 | held_out | third_person | third_person | 0.28 | 93 | -0.199 | 0.315 | 0.0 | None | 0.0 |
| pixabay_34537 | dev | third_person | third_person | 0.072 | 69 | -0.245 | 0.239 | 0.0 | None | 0.857 |
| pixabay_34541 | dev | third_person | third_person | 0.28 | 25 | 0.177 | 0.331 | 0.0 | None | 0.041 |
| pixabay_34772 | held_out | third_person | third_person | 0.0 | 33 | -0.322 | 0.346 | 0.0 | None | 0.274 |
| pixabay_34818 | dev | third_person | third_person | 0.0 | 17 | -0.397 | 0.423 | 0.0 | None | 0.566 |
| pixabay_35005 | dev | third_person | third_person | 0.132 | 76 | 0.128 | 0.384 | 0.0 | None | 0.385 |
| pixabay_35007 | dev | third_person | first_person **x** | 1.0 | 37 | 0.671 | 0.243 | 0.0 | None | 0.411 |
| pixabay_38115 | dev | third_person | third_person | 0.0 | 92 | -0.518 | 0.4 | 0.0 | None | 0.0 |
| pixabay_42040 | held_out | third_person | third_person | 0.267 | 15 | 0.18 | 0.354 | 0.0 | None | 0.377 |
| pixabay_42861 | dev | third_person | third_person | 0.056 | 18 | -0.315 | 0.18 | 0.0 | None | 0.783 |
| pixabay_43238 | held_out | third_person | uncertain | 0.537 | 95 | 0.458 | 0.029 | 0.0 | None | 0.154 |
| pixabay_43653 | held_out | third_person | uncertain | 0.5 | 2 | 0.112 | 0.141 | 0.0 | None | 0.423 |
| pixabay_51807 | dev | third_person | third_person | 0.0 | 166 | -0.501 | 0.383 | 0.0 | None | 0.515 |
| pixabay_5629 | dev | third_person | uncertain | 1.0 | 1 | 0.665 | 0.086 | 0.0 | None | 0.729 |
| pixabay_7376 | held_out | third_person | uncertain | 0.667 | 3 | 0.949 | 0.139 | 0.0 | None | 0.721 |
| pixabay_75700 | dev | third_person | uncertain | 0.0 | 3 | -0.403 | 0.196 | 0.0 | None | 0.238 |
| pixabay_83178 | dev | third_person | uncertain | 0.0 | 7 | -0.869 | 0.084 | 0.0 | None | 0.931 |
| pixabay_8702 | dev | third_person | uncertain | 0.0 | 22 | -0.936 | 0.173 | 0.0 | None | 0.329 |
| pixabay_9520 | dev | third_person | uncertain | 1.0 | 8 | 0.807 | 0.095 | 0.0 | None | 0.868 |
| pixabay_9631 | dev | third_person | third_person | 0.255 | 51 | 0.219 | 0.103 | 0.455 | None | 0.697 |

## Overlays

Green arrow: a hand pointing up the frame (wrist -> middle knuckle); red: not. Confident faces (as the privacy check counts them) are boxed.

![pexels_7204592](overlays/pexels_7204592.jpg)
![pexels_7418650](overlays/pexels_7418650.jpg)
![pexels_37443407](overlays/pexels_37443407.jpg)
![pexels_7658012](overlays/pexels_7658012.jpg)
![pexels_7308220](overlays/pexels_7308220.jpg)
![pexels_4520150](overlays/pexels_4520150.jpg)
![pexels_11102752](overlays/pexels_11102752.jpg)
![pexels_5592524](overlays/pexels_5592524.jpg)
![pexels_4440711](overlays/pexels_4440711.jpg)
![pexels_7641501](overlays/pexels_7641501.jpg)
![pexels_9141844](overlays/pexels_9141844.jpg)
![pixabay_115792](overlays/pixabay_115792.jpg)
![pixabay_35007](overlays/pixabay_35007.jpg)
![pixabay_10822](overlays/pixabay_10822.jpg)
![pixabay_11290](overlays/pixabay_11290.jpg)
![pixabay_11291](overlays/pixabay_11291.jpg)
![pixabay_11305](overlays/pixabay_11305.jpg)
![pixabay_115790](overlays/pixabay_115790.jpg)
![pixabay_115793](overlays/pixabay_115793.jpg)
![pixabay_143161](overlays/pixabay_143161.jpg)
![pixabay_148542](overlays/pixabay_148542.jpg)
![pixabay_150346](overlays/pixabay_150346.jpg)
![pixabay_150362](overlays/pixabay_150362.jpg)
![pixabay_150365](overlays/pixabay_150365.jpg)
![pixabay_150367](overlays/pixabay_150367.jpg)
