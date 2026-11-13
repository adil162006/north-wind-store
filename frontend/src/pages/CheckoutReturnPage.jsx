import { Link, useSearchParams } from "react-router";
import { useCart } from "../store/cart";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuth } from "@clerk/react";
import { AlertCircleIcon, CheckCircle2Icon, LoaderCircleIcon, PackageIcon } from "lucide-react";
import { apiFetch } from "../lib/api";

function CheckoutReturnPage() {
  const clearCart = useCart((s) => s.clear);
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [params] = useSearchParams();
  const checkoutId = params.get("checkout_id");
  const queryClient = useQueryClient();

  const {
    data: confirmation,
    error,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["checkout-confirmation", checkoutId],
    queryFn: () =>
      apiFetch("/api/checkout/confirm", {
        getToken,
        method: "POST",
        body: { checkoutId },
      }),
    enabled: Boolean(checkoutId) && isLoaded && isSignedIn,
    retry: false,
    refetchInterval: (query) => {
      const pending = ["open", "confirmed"].includes(query.state.data?.status);
      return pending && query.state.dataUpdateCount < 20 ? 1500 : false;
    },
  });

  const isPaid = confirmation?.status === "succeeded";

  useEffect(() => {
    if (!isPaid) return;
    clearCart();
    void queryClient.invalidateQueries({ queryKey: ["orders"] });
  }, [isPaid, queryClient, clearCart]);

  return (
    <div className="mx-auto max-w-lg text-center">
      <div className="avatar placeholder mx-auto mb-4">
        <div
          className={`flex w-16 items-center justify-center rounded-full ${
            isPaid ? "bg-success/20 text-success" : "bg-base-300 text-base-content/70"
          }`}
        >
          {isPaid ? (
            <CheckCircle2Icon className="size-10" aria-hidden />
          ) : isLoading || !isLoaded ? (
            <LoaderCircleIcon className="size-10 animate-spin" aria-hidden />
          ) : (
            <AlertCircleIcon className="size-10" aria-hidden />
          )}
        </div>
      </div>

      {isPaid ? (
        <>
          <h1 className="text-2xl font-bold text-base-content">Payment confirmed</h1>
          <p className="mt-4 text-base-content/70">
            Your order is ready. Open it from your orders list for support chat.
          </p>
          <Link to="/orders" className="btn btn-primary mt-8 gap-2">
            <PackageIcon className="size-4" aria-hidden />
            View orders
          </Link>
        </>
      ) : !checkoutId ? (
        <>
          <h1 className="text-2xl font-bold text-base-content">Checkout not found</h1>
          <p className="mt-4 text-base-content/70">
            There is no checkout ID to verify. Your cart has not been cleared.
          </p>
          <Link to="/cart" className="btn btn-primary mt-8">
            Return to cart
          </Link>
        </>
      ) : !isLoaded || isLoading ? (
        <>
          <h1 className="text-2xl font-bold text-base-content">Checking your payment</h1>
          <p className="mt-4 text-base-content/70">Waiting for Polar to confirm the payment.</p>
        </>
      ) : !isSignedIn ? (
        <>
          <h1 className="text-2xl font-bold text-base-content">Sign in to confirm your order</h1>
          <p className="mt-4 text-base-content/70">
            Sign in with the account used to start checkout. Your cart has not been cleared.
          </p>
        </>
      ) : error ? (
        <>
          <h1 className="text-2xl font-bold text-base-content">Could not verify payment</h1>
          <p className="mt-4 text-base-content/70">
            {error instanceof Error ? error.message : "Please try checking again."}
          </p>
          <button type="button" className="btn btn-primary mt-8" onClick={() => void refetch()}>
            Check again
          </button>
        </>
      ) : ["open", "confirmed"].includes(confirmation?.status) ? (
        <>
          <h1 className="text-2xl font-bold text-base-content">Payment is processing</h1>
          <p className="mt-4 text-base-content/70">
            Polar has not confirmed the payment yet. Your cart has not been cleared.
          </p>
          <button type="button" className="btn btn-primary mt-8" onClick={() => void refetch()}>
            Check again
          </button>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold text-base-content">Payment not completed</h1>
          <p className="mt-4 text-base-content/70">
            Polar reported checkout status: {confirmation?.status ?? "unknown"}. Your cart has not
            been cleared.
          </p>
          <Link to="/cart" className="btn btn-primary mt-8">
            Return to cart
          </Link>
        </>
      )}
    </div>
  );
}

export default CheckoutReturnPage;
