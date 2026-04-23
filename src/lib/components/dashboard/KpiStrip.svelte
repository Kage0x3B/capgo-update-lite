<script lang="ts">
    import KpiCard from './KpiCard.svelte';

    type Kpis = {
        activeDevices: number;
        activeDevicesPrev: number;
        updatesDelivered: number;
        updatesDeliveredPrev: number;
        failureRate: number;
        failureRatePrev: number;
        pendingFailedBundles: number;
    };

    let { data }: { data: Kpis } = $props();
</script>

<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
    <KpiCard label="Active devices" value={data.activeDevices} prev={data.activeDevicesPrev} />
    <KpiCard label="Updates delivered" value={data.updatesDelivered} prev={data.updatesDeliveredPrev} />
    <KpiCard label="Failure rate" value={data.failureRate} prev={data.failureRatePrev} format="percent" />
    <KpiCard label="Pending / failed bundles" value={data.pendingFailedBundles} />
</div>
