# Every retained curve and frozen rule

Untraced measurements only. Each point is median batch p50 / median batch p95 / maximum of all samples (ms). Ten-sample p95 is the maximum. Immediate live runs have one batch; warm runs have nine. Traced timings never qualify a latency rule.

## 10%-live-immediate-curve

| Probe | live |
| --- | ---: |
| busyHistory | 1.896 / 3.808 / 3.808 |
| following500 | 3.673 / 5.465 / 5.465 |
| following5 | 3.468 / 3.877 / 3.877 |
| celebrityFollower | 3.484 / 5.047 / 5.047 |
| search100 | 4.438 / 5.246 / 5.246 |
| insights | 1.633 / 1.976 / 1.976 |
| trending | 2.231 / 10.578 / 10.578 |

| Frozen rule | Measured | Ceiling | Margin | Result | Rounds passing |
| --- | ---: | ---: | ---: | --- | ---: |

Every individual round margin is retained in evidence/summary.json.

## 10%-live-warm-curve

| Probe | live |
| --- | ---: |
| busyHistory | 2.134 / 2.994 / 4.308 |
| following500 | 4.130 / 4.674 / 5.370 |
| following5 | 3.696 / 4.763 / 8.878 |
| celebrityFollower | 3.628 / 4.505 / 6.593 |
| search100 | 4.560 / 5.662 / 6.607 |
| insights | 1.901 / 2.469 / 2.766 |
| trending | 2.479 / 2.882 / 11.370 |

| Frozen rule | Measured | Ceiling | Margin | Result | Rounds passing |
| --- | ---: | ---: | ---: | --- | ---: |

Every individual round margin is retained in evidence/summary.json.

## 50%-live-immediate-curve

| Probe | live |
| --- | ---: |
| busyHistory | 1.856 / 3.458 / 3.458 |
| following500 | 3.579 / 3.834 / 3.834 |
| following5 | 3.683 / 3.798 / 3.798 |
| celebrityFollower | 3.689 / 4.409 / 4.409 |
| search100 | 4.588 / 5.875 / 5.875 |
| insights | 1.278 / 2.126 / 2.126 |
| trending | 1.888 / 2.175 / 2.175 |

| Frozen rule | Measured | Ceiling | Margin | Result | Rounds passing |
| --- | ---: | ---: | ---: | --- | ---: |

Every individual round margin is retained in evidence/summary.json.

## 50%-live-warm-curve

| Probe | live |
| --- | ---: |
| busyHistory | 1.973 / 2.608 / 3.386 |
| following500 | 3.980 / 5.022 / 6.735 |
| following5 | 3.981 / 5.339 / 8.443 |
| celebrityFollower | 3.942 / 5.259 / 7.547 |
| search100 | 4.603 / 5.837 / 6.404 |
| insights | 1.750 / 2.327 / 3.394 |
| trending | 2.434 / 3.447 / 9.249 |

| Frozen rule | Measured | Ceiling | Margin | Result | Rounds passing |
| --- | ---: | ---: | ---: | --- | ---: |

Every individual round margin is retained in evidence/summary.json.

## before-curve

| Probe | 10pct | 50pct | full |
| --- | ---: | ---: | ---: |
| busyHistory | 1.457 / 2.368 / 2.874 | 1.321 / 1.951 / 2.624 | 1.516 / 2.153 / 5.577 |
| following500 | 2.837 / 4.170 / 4.962 | 2.903 / 4.547 / 6.810 | 2.892 / 4.617 / 6.405 |
| following5 | 2.678 / 3.929 / 5.471 | 2.774 / 3.442 / 4.306 | 2.807 / 3.946 / 7.580 |
| celebrityFollower | 2.589 / 3.928 / 4.750 | 2.808 / 3.871 / 5.349 | 2.720 / 4.168 / 7.058 |
| search100 | 3.161 / 4.439 / 9.083 | 3.441 / 4.828 / 13.971 | 3.376 / 4.476 / 6.135 |
| insights | 1.076 / 1.665 / 2.496 | 1.171 / 1.834 / 2.499 | 1.217 / 1.970 / 2.696 |
| trending | 1.460 / 2.473 / 2.965 | 1.573 / 2.064 / 2.840 | 1.599 / 2.262 / 3.288 |

| Frozen rule | Measured | Ceiling | Margin | Result | Rounds passing |
| --- | ---: | ---: | ---: | --- | ---: |
| search100FullSmall | 1.008 | 3.000 | +1.992 ratio | Pass | 9/9 |
| search100MidCurve | 4.828 | 4.455 | -0.372 ms | Fail | 3/9 |
| insightsFullSmall | 1.183 | 3.000 | +1.817 ratio | Pass | 9/9 |
| insightsMidCurve | 1.834 | 1.800 | -0.034 ms | Fail | 2/9 |
| trendingFullSmall | 0.915 | 3.000 | +2.085 ratio | Pass | 9/9 |
| trendingMidCurve | 2.064 | 2.379 | +0.315 ms | Pass | 7/9 |
| following500 | 1.170 | 3.000 | +1.830 ratio | Pass | 9/9 |
| celebrityRead | 1.056 | 3.000 | +1.944 ratio | Pass | 9/9 |
| deepPaging | 0.537 | 3.000 | +2.463 ratio | Pass | 0/0 |

Every individual round margin is retained in evidence/summary.json.

## cache-16m-curve

| Probe | 10pct | 50pct | full |
| --- | ---: | ---: | ---: |
| busyHistory | 1.660 / 2.749 / 3.648 | 1.398 / 2.449 / 2.904 | 1.544 / 2.861 / 4.311 |
| following500 | 2.984 / 3.838 / 5.024 | 2.830 / 4.050 / 4.783 | 3.129 / 4.095 / 5.894 |
| following5 | 3.026 / 3.398 / 5.052 | 2.646 / 3.695 / 8.927 | 2.948 / 3.737 / 8.375 |
| celebrityFollower | 3.010 / 3.561 / 4.831 | 2.819 / 4.092 / 6.001 | 3.039 / 4.558 / 7.838 |
| search100 | 3.683 / 4.598 / 5.928 | 3.398 / 4.607 / 15.680 | 3.453 / 4.586 / 8.328 |
| insights | 1.310 / 2.028 / 14.773 | 1.238 / 1.949 / 2.760 | 1.339 / 1.702 / 2.806 |
| trending | 1.869 / 2.318 / 3.182 | 1.748 / 2.422 / 2.943 | 1.772 / 2.999 / 3.868 |

| Frozen rule | Measured | Ceiling | Margin | Result | Rounds passing |
| --- | ---: | ---: | ---: | --- | ---: |
| search100FullSmall | 0.997 | 3.000 | +2.003 ratio | Pass | 9/9 |
| search100MidCurve | 4.607 | 4.593 | -0.014 ms | Fail | 6/9 |
| insightsFullSmall | 0.839 | 3.000 | +2.161 ratio | Pass | 9/9 |
| insightsMidCurve | 1.949 | 1.883 | -0.066 ms | Fail | 4/9 |
| trendingFullSmall | 1.294 | 3.000 | +1.706 ratio | Pass | 9/9 |
| trendingMidCurve | 2.422 | 2.620 | +0.199 ms | Pass | 6/9 |
| following500 | 1.096 | 3.000 | +1.904 ratio | Pass | 9/9 |
| celebrityRead | 1.220 | 3.000 | +1.780 ratio | Pass | 9/9 |

Every individual round margin is retained in evidence/summary.json.

## cache-256m-curve

| Probe | 10pct | 50pct | full |
| --- | ---: | ---: | ---: |
| busyHistory | 1.695 / 2.742 / 3.282 | 1.648 / 2.809 / 14.032 | 1.789 / 2.766 / 7.841 |
| following500 | 3.027 / 3.751 / 5.013 | 2.989 / 3.305 / 5.211 | 3.128 / 4.142 / 5.060 |
| following5 | 2.883 / 4.103 / 5.469 | 2.610 / 3.711 / 5.294 | 3.025 / 3.639 / 8.604 |
| celebrityFollower | 2.841 / 3.727 / 4.611 | 2.921 / 4.005 / 4.490 | 3.047 / 3.938 / 11.299 |
| search100 | 3.569 / 4.042 / 5.344 | 3.583 / 4.765 / 15.225 | 3.436 / 5.249 / 8.174 |
| insights | 1.507 / 2.251 / 2.837 | 1.351 / 2.555 / 2.907 | 1.336 / 1.989 / 3.017 |
| trending | 1.965 / 3.320 / 3.656 | 1.787 / 2.151 / 3.259 | 1.535 / 2.170 / 2.819 |

| Frozen rule | Measured | Ceiling | Margin | Result | Rounds passing |
| --- | ---: | ---: | ---: | --- | ---: |
| search100FullSmall | 1.299 | 3.000 | +1.701 ratio | Pass | 9/9 |
| search100MidCurve | 4.765 | 4.579 | -0.187 ms | Fail | 4/9 |
| insightsFullSmall | 0.883 | 3.000 | +2.117 ratio | Pass | 9/9 |
| insightsMidCurve | 2.555 | 2.134 | -0.421 ms | Fail | 2/9 |
| trendingFullSmall | 0.654 | 3.000 | +2.346 ratio | Pass | 9/9 |
| trendingMidCurve | 2.151 | 2.809 | +0.657 ms | Pass | 6/9 |
| following500 | 1.138 | 3.000 | +1.862 ratio | Pass | 9/9 |
| celebrityRead | 1.082 | 3.000 | +1.918 ratio | Pass | 8/9 |

Every individual round margin is retained in evidence/summary.json.

## cache-both-curve

| Probe | 10pct | 50pct | full |
| --- | ---: | ---: | ---: |
| busyHistory | 1.843 / 3.030 / 5.784 | 1.715 / 2.814 / 5.802 | 1.772 / 3.021 / 8.166 |
| following500 | 3.103 / 4.353 / 4.839 | 3.025 / 4.172 / 9.205 | 3.228 / 4.510 / 5.906 |
| following5 | 2.980 / 3.939 / 5.219 | 2.885 / 4.589 / 5.235 | 3.109 / 4.424 / 8.903 |
| celebrityFollower | 2.977 / 4.192 / 5.102 | 2.935 / 3.877 / 5.546 | 3.130 / 4.206 / 10.037 |
| search100 | 3.555 / 4.627 / 16.790 | 3.495 / 4.701 / 13.930 | 3.636 / 4.641 / 7.147 |
| insights | 1.453 / 2.381 / 2.833 | 1.356 / 2.360 / 3.067 | 1.471 / 2.357 / 2.679 |
| trending | 1.839 / 3.117 / 4.501 | 1.858 / 2.833 / 3.769 | 1.773 / 2.475 / 3.266 |

| Frozen rule | Measured | Ceiling | Margin | Result | Rounds passing |
| --- | ---: | ---: | ---: | --- | ---: |
| search100FullSmall | 1.003 | 3.000 | +1.997 ratio | Pass | 9/9 |
| search100MidCurve | 4.701 | 4.633 | -0.067 ms | Fail | 6/9 |
| insightsFullSmall | 0.990 | 3.000 | +2.010 ratio | Pass | 9/9 |
| insightsMidCurve | 2.360 | 2.371 | +0.011 ms | Pass | 5/9 |
| trendingFullSmall | 0.794 | 3.000 | +2.206 ratio | Pass | 9/9 |
| trendingMidCurve | 2.833 | 2.832 | -0.002 ms | Fail | 3/9 |
| following500 | 1.020 | 3.000 | +1.980 ratio | Pass | 9/9 |
| celebrityRead | 0.951 | 3.000 | +2.049 ratio | Pass | 9/9 |

Every individual round margin is retained in evidence/summary.json.

## cache-default-curve

| Probe | 10pct | 50pct | full |
| --- | ---: | ---: | ---: |
| busyHistory | 1.608 / 2.546 / 3.187 | 1.512 / 2.056 / 2.985 | 1.837 / 2.453 / 8.733 |
| following500 | 2.853 / 3.920 / 5.457 | 2.941 / 3.996 / 4.597 | 2.886 / 4.449 / 6.237 |
| following5 | 2.935 / 4.024 / 5.075 | 2.692 / 3.624 / 4.820 | 2.930 / 3.878 / 7.589 |
| celebrityFollower | 2.748 / 3.340 / 4.369 | 2.788 / 3.333 / 6.892 | 2.720 / 3.921 / 7.122 |
| search100 | 3.333 / 4.371 / 5.193 | 3.414 / 5.216 / 9.284 | 3.391 / 4.601 / 6.276 |
| insights | 1.342 / 1.942 / 9.577 | 1.341 / 2.191 / 2.724 | 1.120 / 2.035 / 2.556 |
| trending | 1.698 / 2.826 / 3.772 | 1.939 / 2.312 / 4.761 | 1.647 / 2.931 / 3.599 |

| Frozen rule | Measured | Ceiling | Margin | Result | Rounds passing |
| --- | ---: | ---: | ---: | --- | ---: |
| search100FullSmall | 1.053 | 3.000 | +1.947 ratio | Pass | 9/9 |
| search100MidCurve | 5.216 | 4.473 | -0.743 ms | Fail | 1/9 |
| insightsFullSmall | 1.048 | 3.000 | +1.952 ratio | Pass | 9/9 |
| insightsMidCurve | 2.191 | 1.983 | -0.207 ms | Fail | 3/9 |
| trendingFullSmall | 1.037 | 3.000 | +1.963 ratio | Pass | 9/9 |
| trendingMidCurve | 2.312 | 2.873 | +0.560 ms | Pass | 7/9 |
| following500 | 1.147 | 3.000 | +1.853 ratio | Pass | 9/9 |
| celebrityRead | 1.011 | 3.000 | +1.989 ratio | Pass | 9/9 |

Every individual round margin is retained in evidence/summary.json.

## cache-mmap-curve

| Probe | 10pct | 50pct | full |
| --- | ---: | ---: | ---: |
| busyHistory | 1.807 / 2.712 / 5.261 | 1.808 / 3.327 / 15.037 | 1.882 / 3.112 / 8.087 |
| following500 | 2.965 / 4.161 / 5.293 | 3.136 / 3.803 / 5.475 | 3.111 / 3.622 / 6.147 |
| following5 | 2.792 / 3.988 / 5.493 | 3.131 / 3.785 / 5.126 | 3.056 / 4.213 / 9.202 |
| celebrityFollower | 2.839 / 3.444 / 4.679 | 3.027 / 3.485 / 4.534 | 3.027 / 4.477 / 9.378 |
| search100 | 3.502 / 4.339 / 5.412 | 3.690 / 5.171 / 13.311 | 3.476 / 4.550 / 8.137 |
| insights | 1.339 / 1.790 / 2.821 | 1.642 / 2.493 / 3.221 | 1.387 / 2.125 / 3.082 |
| trending | 1.796 / 2.564 / 3.342 | 2.092 / 2.753 / 3.956 | 1.899 / 2.023 / 3.497 |

| Frozen rule | Measured | Ceiling | Margin | Result | Rounds passing |
| --- | ---: | ---: | ---: | --- | ---: |
| search100FullSmall | 1.048 | 3.000 | +1.952 ratio | Pass | 9/9 |
| search100MidCurve | 5.171 | 4.433 | -0.738 ms | Fail | 4/9 |
| insightsFullSmall | 1.187 | 3.000 | +1.813 ratio | Pass | 9/9 |
| insightsMidCurve | 2.493 | 1.939 | -0.554 ms | Fail | 2/9 |
| trendingFullSmall | 0.789 | 3.000 | +2.211 ratio | Pass | 9/9 |
| trendingMidCurve | 2.753 | 2.324 | -0.429 ms | Fail | 3/9 |
| following500 | 0.860 | 3.000 | +2.140 ratio | Pass | 9/9 |
| celebrityRead | 1.063 | 3.000 | +1.937 ratio | Pass | 9/9 |

Every individual round margin is retained in evidence/summary.json.

## cache-small-curve

| Probe | 10pct | 50pct | full |
| --- | ---: | ---: | ---: |
| busyHistory | 1.541 / 2.081 / 2.947 | 1.713 / 2.480 / 3.495 | 1.486 / 2.817 / 8.310 |
| following500 | 3.775 / 4.567 / 5.686 | 4.516 / 5.361 / 6.646 | 4.267 / 5.098 / 6.943 |
| following5 | 3.640 / 4.661 / 5.790 | 4.109 / 4.662 / 10.516 | 3.740 / 4.643 / 6.131 |
| celebrityFollower | 3.658 / 4.463 / 5.581 | 4.047 / 5.528 / 5.855 | 3.961 / 5.151 / 10.014 |
| search100 | 4.708 / 5.732 / 6.521 | 5.363 / 6.185 / 9.405 | 5.512 / 6.259 / 8.071 |
| insights | 1.422 / 1.669 / 5.479 | 1.356 / 1.998 / 2.336 | 1.274 / 1.842 / 2.861 |
| trending | 1.776 / 2.363 / 3.046 | 1.968 / 2.885 / 3.534 | 1.942 / 2.525 / 3.921 |

| Frozen rule | Measured | Ceiling | Margin | Result | Rounds passing |
| --- | ---: | ---: | ---: | --- | ---: |
| search100FullSmall | 1.092 | 3.000 | +1.908 ratio | Pass | 9/9 |
| search100MidCurve | 6.185 | 5.966 | -0.219 ms | Fail | 3/9 |
| insightsFullSmall | 1.103 | 3.000 | +1.897 ratio | Pass | 9/9 |
| insightsMidCurve | 1.998 | 1.746 | -0.252 ms | Fail | 5/9 |
| trendingFullSmall | 1.069 | 3.000 | +1.931 ratio | Pass | 9/9 |
| trendingMidCurve | 2.885 | 2.435 | -0.450 ms | Fail | 3/9 |
| following500 | 1.098 | 3.000 | +1.902 ratio | Pass | 9/9 |
| celebrityRead | 1.109 | 3.000 | +1.891 ratio | Pass | 9/9 |

Every individual round margin is retained in evidence/summary.json.

## control-after-curve

| Probe | 10pct | 50pct | full |
| --- | ---: | ---: | ---: |
| busyHistory | 1.355 / 2.186 / 2.420 | 1.537 / 2.152 / 3.115 | 1.194 / 2.241 / 4.637 |
| following500 | 2.509 / 3.671 / 4.726 | 2.879 / 4.191 / 4.998 | 2.607 / 4.182 / 5.136 |
| following5 | 2.433 / 3.353 / 4.663 | 2.540 / 3.992 / 9.869 | 2.520 / 4.413 / 7.439 |
| celebrityFollower | 2.575 / 3.504 / 4.656 | 2.307 / 3.058 / 4.957 | 2.703 / 4.278 / 7.478 |
| search100 | 3.050 / 3.879 / 5.253 | 3.108 / 4.566 / 8.382 | 3.288 / 4.573 / 6.245 |
| insights | 1.110 / 1.781 / 11.163 | 1.069 / 1.438 / 1.898 | 0.931 / 1.577 / 2.015 |
| trending | 1.551 / 2.006 / 4.002 | 1.706 / 2.140 / 3.627 | 1.628 / 2.379 / 3.704 |

| Frozen rule | Measured | Ceiling | Margin | Result | Rounds passing |
| --- | ---: | ---: | ---: | --- | ---: |
| search100FullSmall | 1.179 | 3.000 | +1.821 ratio | Pass | 9/9 |
| search100MidCurve | 4.566 | 4.188 | -0.378 ms | Fail | 2/9 |
| insightsFullSmall | 0.885 | 3.000 | +2.115 ratio | Pass | 9/9 |
| insightsMidCurve | 1.438 | 1.691 | +0.253 ms | Pass | 6/9 |
| trendingFullSmall | 1.186 | 3.000 | +1.814 ratio | Pass | 9/9 |
| trendingMidCurve | 2.140 | 2.172 | +0.032 ms | Pass | 5/9 |
| following500 | 0.948 | 3.000 | +2.052 ratio | Pass | 9/9 |
| celebrityRead | 0.969 | 3.000 | +2.031 ratio | Pass | 9/9 |
| deepPaging | 0.913 | 3.000 | +2.087 ratio | Pass | 9/9 |

Every individual round margin is retained in evidence/summary.json.

## control-before-curve

| Probe | 10pct | 50pct | full |
| --- | ---: | ---: | ---: |
| busyHistory | 1.504 / 2.464 / 3.077 | 1.525 / 2.401 / 2.800 | 1.751 / 2.518 / 8.614 |
| following500 | 2.767 / 4.212 / 4.935 | 2.860 / 3.999 / 10.405 | 3.039 / 4.361 / 6.053 |
| following5 | 2.793 / 3.533 / 4.111 | 2.721 / 3.470 / 4.487 | 2.750 / 3.718 / 7.550 |
| celebrityFollower | 2.585 / 2.916 / 4.653 | 2.783 / 3.925 / 15.390 | 2.807 / 3.643 / 10.639 |
| search100 | 3.220 / 4.229 / 11.711 | 3.384 / 4.794 / 15.756 | 3.366 / 4.872 / 7.519 |
| insights | 1.202 / 1.836 / 2.041 | 1.228 / 2.019 / 2.612 | 1.184 / 1.943 / 2.200 |
| trending | 1.692 / 2.143 / 3.252 | 1.662 / 2.182 / 10.524 | 1.688 / 2.580 / 3.148 |

| Frozen rule | Measured | Ceiling | Margin | Result | Rounds passing |
| --- | ---: | ---: | ---: | --- | ---: |
| search100FullSmall | 1.152 | 3.000 | +1.848 ratio | Pass | 9/9 |
| search100MidCurve | 4.794 | 4.514 | -0.280 ms | Fail | 4/9 |
| insightsFullSmall | 1.059 | 3.000 | +1.941 ratio | Pass | 9/9 |
| insightsMidCurve | 2.019 | 1.884 | -0.136 ms | Fail | 2/9 |
| trendingFullSmall | 1.204 | 3.000 | +1.796 ratio | Pass | 9/9 |
| trendingMidCurve | 2.182 | 2.338 | +0.155 ms | Pass | 6/9 |
| following500 | 1.173 | 3.000 | +1.827 ratio | Pass | 9/9 |
| celebrityRead | 0.980 | 3.000 | +2.020 ratio | Pass | 9/9 |
| deepPaging | 0.869 | 3.000 | +2.131 ratio | Pass | 9/9 |

Every individual round margin is retained in evidence/summary.json.

## full-live-immediate-curve

| Probe | live |
| --- | ---: |
| busyHistory | 1.740 / 3.395 / 3.395 |
| following500 | 3.424 / 3.825 / 3.825 |
| following5 | 3.714 / 4.987 / 4.987 |
| celebrityFollower | 3.688 / 4.000 / 4.000 |
| search100 | 4.494 / 4.970 / 4.970 |
| insights | 1.527 / 1.903 / 1.903 |
| trending | 2.309 / 3.085 / 3.085 |

| Frozen rule | Measured | Ceiling | Margin | Result | Rounds passing |
| --- | ---: | ---: | ---: | --- | ---: |

Every individual round margin is retained in evidence/summary.json.

## full-live-warm-curve

| Probe | live |
| --- | ---: |
| busyHistory | 2.341 / 3.326 / 4.621 |
| following500 | 4.280 / 5.332 / 9.330 |
| following5 | 4.058 / 5.322 / 8.262 |
| celebrityFollower | 3.944 / 5.597 / 7.240 |
| search100 | 4.943 / 6.021 / 10.062 |
| insights | 1.984 / 3.003 / 4.442 |
| trending | 2.666 / 3.458 / 7.482 |

| Frozen rule | Measured | Ceiling | Margin | Result | Rounds passing |
| --- | ---: | ---: | ---: | --- | ---: |

Every individual round margin is retained in evidence/summary.json.

## live-immediate-curve

| Probe | 10pct | 50pct | full |
| --- | ---: | ---: | ---: |
| busyHistory | 1.896 / 3.808 / 3.808 | 1.856 / 3.458 / 3.458 | 1.740 / 3.395 / 3.395 |
| following500 | 3.673 / 5.465 / 5.465 | 3.579 / 3.834 / 3.834 | 3.424 / 3.825 / 3.825 |
| following5 | 3.468 / 3.877 / 3.877 | 3.683 / 3.798 / 3.798 | 3.714 / 4.987 / 4.987 |
| celebrityFollower | 3.484 / 5.047 / 5.047 | 3.689 / 4.409 / 4.409 | 3.688 / 4.000 / 4.000 |
| search100 | 4.438 / 5.246 / 5.246 | 4.588 / 5.875 / 5.875 | 4.494 / 4.970 / 4.970 |
| insights | 1.633 / 1.976 / 1.976 | 1.278 / 2.126 / 2.126 | 1.527 / 1.903 / 1.903 |
| trending | 2.231 / 10.578 / 10.578 | 1.888 / 2.175 / 2.175 | 2.309 / 3.085 / 3.085 |

| Frozen rule | Measured | Ceiling | Margin | Result | Rounds passing |
| --- | ---: | ---: | ---: | --- | ---: |
| search100FullSmall | 0.947 | 3.000 | +2.053 ratio | Pass | 1/1 |
| search100MidCurve | 5.875 | 5.123 | -0.752 ms | Fail | 0/1 |
| insightsFullSmall | 0.963 | 3.000 | +2.037 ratio | Pass | 1/1 |
| insightsMidCurve | 2.126 | 1.944 | -0.182 ms | Fail | 0/1 |
| trendingFullSmall | 0.292 | 3.000 | +2.708 ratio | Pass | 1/1 |
| trendingMidCurve | 2.175 | 7.247 | +5.072 ms | Pass | 1/1 |
| following500 | 0.767 | 3.000 | +2.233 ratio | Pass | 1/1 |
| celebrityRead | 0.802 | 3.000 | +2.198 ratio | Pass | 1/1 |

Every individual round margin is retained in evidence/summary.json.

## live-warm-curve

| Probe | 10pct | 50pct | full |
| --- | ---: | ---: | ---: |
| busyHistory | 2.134 / 2.994 / 4.308 | 1.973 / 2.608 / 3.386 | 2.341 / 3.326 / 4.621 |
| following500 | 4.130 / 4.674 / 5.370 | 3.980 / 5.022 / 6.735 | 4.280 / 5.332 / 9.330 |
| following5 | 3.696 / 4.763 / 8.878 | 3.981 / 5.339 / 8.443 | 4.058 / 5.322 / 8.262 |
| celebrityFollower | 3.628 / 4.505 / 6.593 | 3.942 / 5.259 / 7.547 | 3.944 / 5.597 / 7.240 |
| search100 | 4.560 / 5.662 / 6.607 | 4.603 / 5.837 / 6.404 | 4.943 / 6.021 / 10.062 |
| insights | 1.901 / 2.469 / 2.766 | 1.750 / 2.327 / 3.394 | 1.984 / 3.003 / 4.442 |
| trending | 2.479 / 2.882 / 11.370 | 2.434 / 3.447 / 9.249 | 2.666 / 3.458 / 7.482 |

| Frozen rule | Measured | Ceiling | Margin | Result | Rounds passing |
| --- | ---: | ---: | ---: | --- | ---: |
| search100FullSmall | 1.063 | 3.000 | +1.937 ratio | Pass | 9/9 |
| search100MidCurve | 5.837 | 5.822 | -0.016 ms | Fail | 5/9 |
| insightsFullSmall | 1.216 | 3.000 | +1.784 ratio | Pass | 9/9 |
| insightsMidCurve | 2.327 | 2.706 | +0.379 ms | Pass | 7/9 |
| trendingFullSmall | 1.200 | 3.000 | +1.800 ratio | Pass | 9/9 |
| trendingMidCurve | 3.447 | 3.138 | -0.309 ms | Fail | 3/9 |
| following500 | 1.002 | 3.000 | +1.998 ratio | Pass | 9/9 |
| celebrityRead | 1.052 | 3.000 | +1.948 ratio | Pass | 9/9 |

Every individual round margin is retained in evidence/summary.json.

## restarted-curve

| Probe | replayed-10pct | replayed-50pct | replayed-full |
| --- | ---: | ---: | ---: |
| busyHistory | 1.722 / 2.718 / 4.038 | 1.753 / 2.761 / 14.580 | 1.937 / 3.098 / 8.588 |
| following500 | 3.046 / 3.983 / 4.652 | 3.112 / 4.063 / 6.125 | 3.301 / 4.254 / 6.127 |
| following5 | 2.974 / 3.371 / 5.093 | 2.960 / 4.016 / 4.920 | 3.138 / 4.088 / 9.048 |
| celebrityFollower | 2.897 / 3.850 / 5.072 | 2.953 / 3.868 / 4.593 | 3.134 / 3.697 / 9.826 |
| search100 | 3.535 / 5.024 / 6.038 | 3.585 / 5.334 / 15.124 | 3.646 / 4.884 / 7.742 |
| insights | 1.450 / 2.491 / 2.676 | 1.441 / 2.430 / 2.571 | 1.505 / 2.601 / 2.919 |
| trending | 1.910 / 2.243 / 3.672 | 1.900 / 2.291 / 3.976 | 1.943 / 2.483 / 3.368 |

| Frozen rule | Measured | Ceiling | Margin | Result | Rounds passing |
| --- | ---: | ---: | ---: | --- | ---: |
| search100FullSmall | 0.972 | 3.000 | +2.028 ratio | Pass | 9/9 |
| search100MidCurve | 5.334 | 4.962 | -0.373 ms | Fail | 4/9 |
| insightsFullSmall | 1.044 | 3.000 | +1.956 ratio | Pass | 9/9 |
| insightsMidCurve | 2.430 | 2.540 | +0.110 ms | Pass | 6/9 |
| trendingFullSmall | 1.107 | 3.000 | +1.893 ratio | Pass | 9/9 |
| trendingMidCurve | 2.291 | 2.350 | +0.059 ms | Pass | 6/9 |
| following500 | 1.041 | 3.000 | +1.959 ratio | Pass | 9/9 |
| celebrityRead | 0.904 | 3.000 | +2.096 ratio | Pass | 9/9 |
| deepPaging | 1.006 | 3.000 | +1.994 ratio | Pass | 0/0 |

Every individual round margin is retained in evidence/summary.json.

## Frozen write rule (full verified replay, same unchanged product)

Celebrity write p95 9.593 ms (200 writes); five-follower author p95 10.628 ms (8096 writes). Ratio 0.903 <= 3; margin +2.097; Pass. Read-only before/after controls do not remeasure this rule.
