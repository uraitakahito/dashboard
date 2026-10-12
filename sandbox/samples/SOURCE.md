# サンドボックスの WACZ の標本

[wacz-validator-corpus](https://github.com/uraitakahito/wacz-validator-corpus) の **v0.2.1** の
`fixtures/` から写した（corpus では Git LFS で持っている。ここには実物を置いた）。
corpus を更新しても、ここは自動では変わらない。上げるなら、写し直してこの表も直す。

| ファイル | corpus での期待（spec profile） | sha256 |
| --- | --- | --- |
| `good.wacz` | 全 rule を pass | `3a0f0fdc8cd610569cbfa8d560c7890a391df6b8f46d37423cb67be9cb67eaac` |
| `warc-payload-digest-bad.wacz` | 警告 1 | `fd978c6bff3b00faa9197d50c85c8b14e83c2cb24eadcebc641c0b3ee21ce00c` |
| `datapackage-bad-hash.wacz` | 失敗 1 | `8cb0e1a82ed3f5972a67466022e0c4d638f0f7d8750b81fcbd503294b2844ede` |
| `cdxj-length-mismatch.wacz` | 失敗 1 | `9e3d8e1f10eab9c8decbeeb13130e8a1a47822e7ca43fb791f78458b6b1f093d` |
| `wacz-missing-indexes.wacz` | 失敗 2 | `499a7eec72bae132cfb3ffdf9447cf35f6e7e74a71f3e3b86122090909efc239` |

corpus の LFS の pointer と同じ中身かは、次で確かめられる（corpus を隣に置いて）:

```sh
for f in sandbox/samples/*.wacz; do
  want=$(git -C ../wacz-validator-corpus show "v0.2.1:fixtures/$(basename "$f")" | sed -n 's/^oid sha256://p')
  got=$(shasum -a 256 "$f" | cut -d' ' -f1)
  [ "$want" = "$got" ] && echo "ok  $f" || echo "NG  $f"
done
```

corpus は Unlicense（public domain）。
