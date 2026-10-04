#!/bin/sh
# 验证 git 提交 / 推送守卫真的会拦住 video/。
#   sh scripts/test-git-hooks.sh
# 在临时目录里克隆本仓库，制造"误提交 video/"，确认两个 hook 都会失败。
set -eu
root=$(git rev-parse --show-toplevel)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/dsh-meihua-hooks-XXXXXX")
trap 'rm -rf "$tmp"' EXIT

work="$tmp/work"
bare="$tmp/remote.git"
git clone --quiet --no-hardlinks "$root" "$work"
git init --quiet --bare "$bare"
# 用工作区里的当前版本覆盖克隆内容，确保测的是本次改动而不是上一次提交
cp "$root/.gitignore" "$work/.gitignore"
mkdir -p "$work/scripts/git-hooks"
cp "$root/scripts/git-hooks/pre-commit" "$root/scripts/git-hooks/pre-push" "$work/scripts/git-hooks/"
chmod +x "$work/scripts/git-hooks/"*
git -C "$work" config core.hooksPath scripts/git-hooks
git -C "$work" config user.name "hook test"
git -C "$work" config user.email "hook-test@example.invalid"

pass=0
fail=0
check() { # check <描述> <期望:pass|block> <命令...>
	label=$1; want=$2; shift 2
	if "$@" >"$tmp/out" 2>&1; then got=pass; else got=block; fi
	if [ "$got" = "$want" ]; then
		echo "ok   - $label ($got)"
		pass=$((pass + 1))
	else
		echo "FAIL - $label (期望 ${want}，实际 ${got})"
		sed 's/^/       /' "$tmp/out"
		fail=$((fail + 1))
	fi
}

mkdir -p "$work/video/out"
echo "render" >"$work/video/out/film.mp4"
echo "note" >"$work/video/notes.md"

check "普通 add 不会暂存 video/（.gitignore 生效）" pass sh -c "
	cd '$work' && git add -A && test -z \"\$(git diff --cached --name-only -- video/)\""

git -C "$work" checkout --quiet -- . 2>/dev/null || true
git -C "$work" reset --quiet
git -C "$work" add -f video/out/film.mp4
check "强制暂存后 pre-commit 拒绝提交" block git -C "$work" commit -m "oops: add video"

git -C "$work" commit --quiet --no-verify -m "oops: add video"
git -C "$work" remote set-url origin "$bare"
check "被绕过的提交在 pre-push 被拒绝" block git -C "$work" push --quiet origin HEAD:refs/heads/main
check "远端没有收到任何引用" pass sh -c "test -z \"\$(git -C '$bare' for-each-ref --format='%(refname)' refs/heads/)\""

echo
echo "通过 $pass 项，失败 $fail 项"
[ "$fail" -eq 0 ]
