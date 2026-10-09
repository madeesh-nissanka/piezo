#!/usr/bin/env python3
"""
Fake solver simulator for Piezo testing.
Prints 30 lines like "step 7 residual 3.2e-04", a WARNING at one step,
and "Converged in 30 steps" at the end.
Options: --fail prints ERROR and exits 1; --sleep <seconds> sleeps between steps.
"""
import sys
import time
import argparse
import random

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fail", action="store_true", help="Print ERROR and exit 1")
    parser.add_argument("--sleep", type=float, default=0.1, help="Sleep between steps (seconds)")
    parser.add_argument("--steps", type=int, default=30, help="Number of steps")
    args = parser.parse_args()

    for i in range(1, args.steps + 1):
        residual = random.uniform(1e-3, 1e-5)
        print(f"step {i} residual {residual:.2e}")
        if i == 15:
            print("WARNING: line search backtracked")
        if args.sleep:
            time.sleep(args.sleep)
        sys.stdout.flush()

    if args.fail:
        print("ERROR: singular matrix")
        sys.exit(1)

    print(f"Converged in {args.steps} steps")

if __name__ == "__main__":
    main()