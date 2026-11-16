<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/src/signoff.php';

function assert_signoff(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function rejects_signoff(callable $attempt, string $type): void
{
    try {
        $attempt();
    } catch (Throwable $e) {
        assert_signoff($e instanceof $type, 'Unexpected validation exception: ' . get_class($e));
        return;
    }
    throw new RuntimeException('Expected sign-off validation to fail');
}

$policy = ['revision' => 7, 'rating_required' => false, 'comment_required' => false, 'options' => [
    ['id' => '20', 'label' => '1', 'active' => true],
    ['id' => '21', 'label' => '1.5', 'active' => true],
    ['id' => '22', 'label' => 'Developing', 'active' => true],
    ['id' => '23', 'label' => 'Retired', 'active' => false],
]];
assert_signoff(signoff_validate_policy($policy) === $policy, 'Policy keeps label text and order');
assert_signoff(signoff_validate_completion([], $policy) === [null, null, null], 'No requirements');
foreach (['20' => '1', '21' => '1.5', '22' => 'Developing'] as $id => $label) {
    $ratingOnly = array_replace($policy, ['rating_required' => true]);
    assert_signoff(signoff_validate_completion(['rating_option_id' => (string)$id, 'policy_revision' => 7], $ratingOnly)
        === [(string)$id, $label, null], 'Rating only preserves the exact label');
}
$commentsOnly = array_replace($policy, ['comment_required' => true]);
$both = array_replace($commentsOnly, ['rating_required' => true]);
assert_signoff(signoff_validate_completion(['comment' => '  Good work  '], $commentsOnly) === [null, null, 'Good work'], 'Comment only');
assert_signoff(signoff_validate_completion(['rating_option_id' => '22', 'comment' => 'Ready', 'policy_revision' => 7], $both)
    === ['22', 'Developing', 'Ready'], 'Rating and comment');
rejects_signoff(fn() => signoff_validate_completion([], $ratingOnly), InvalidArgumentException::class);
rejects_signoff(fn() => signoff_validate_completion(['comment' => "\u{00A0} \n"], $commentsOnly), InvalidArgumentException::class);
rejects_signoff(fn() => signoff_validate_completion(['rating_option_id' => '23', 'policy_revision' => 7], $policy), InvalidArgumentException::class);
rejects_signoff(fn() => signoff_validate_completion(['rating_option_id' => '99', 'policy_revision' => 7], $policy), InvalidArgumentException::class);
rejects_signoff(fn() => signoff_validate_completion(['rating_option_id' => '22'], $policy), InvalidArgumentException::class);
rejects_signoff(fn() => signoff_validate_completion(['rating_option_id' => '22', 'policy_revision' => 6], $policy), SignoffConflict::class);
rejects_signoff(fn() => signoff_validate_policy(array_replace($ratingOnly, ['options' => []])), InvalidArgumentException::class);
echo "Sign-off validation tests passed\n";
