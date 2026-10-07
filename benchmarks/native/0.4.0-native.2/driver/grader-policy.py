"""Applicability only. This module deliberately computes no numeric scores."""
def o4_profile(m6_green, m6, m8, full_run):
    if not m6_green:
        return {'eligible':False,'score':None,'reason':'m6-not-green','overallEligible':False}
    evidence=[m6]+([m8] if full_run else [])
    if any(e is None or e.get('pass') is None or e.get('valid') is not True for e in evidence):
        return {'eligible':True,'score':None,'reason':'native-unmeasured','overallEligible':False}
    return {'eligible':True,'score':None,'reason':'grader-judgment-required','overallEligible':None}
